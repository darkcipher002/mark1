/**
 * PropFlow KE — tenant access & payment QR (landlord side).
 * Creates the tenant's portal login (email + phone number as first password, changed on first sign-in),
 * and gives a per-tenancy QR code that opens the login-free pay page.
 */
(function () {
  const PF = (window.PF = window.PF || {});
  const $ = (id) => document.getElementById(id);
  let mounted = false, cur = null;

  function loadQR() {
    if (window.qrcode) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/js/vendor/qrcode.js"; s.onload = res; s.onerror = () => rej(new Error("Could not load QR code")); document.head.appendChild(s); });
  }
  function qrSvg(text, size) {
    const q = window.qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace("<svg", `<svg width="${size}" height="${size}" role="img" aria-label="QR code"`);
  }
  const phoneDigits = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("254")) d = "0" + d.slice(3); else if (d.length === 9) d = "0" + d; return d; };
  const loginUrl = () => location.origin + "/tenant/";
  const payUrl = (l) => `${location.origin}/pay/?l=${l.id}&t=${l.payToken}`;

  function mount() {
    if (mounted) return; mounted = true;
    const d = document.createElement("div");
    d.innerHTML = `<div id="access-modal" class="modal" aria-hidden="true"><div class="sheet max-w-md" role="dialog" aria-modal="true" aria-labelledby="ac-title">
      <div class="p-5 border-b border-[var(--line)] flex items-start justify-between gap-3"><div><h3 id="ac-title" class="text-lg font-semibold">Tenant access</h3><p id="ac-sub" class="text-sm text-gray-500"></p></div><button class="p-2 -m-2 text-gray-400 hover:text-gray-700" data-ac-close aria-label="Close">✕</button></div>
      <div class="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
        <div class="tabs"><button class="tab on" data-ac-tab="qr">Pay QR code</button><button class="tab" data-ac-tab="login">Sign-in details</button></div>
        <div id="ac-qr">
          <div class="flex flex-col items-center text-center"><div id="ac-qr-img" class="w-52 h-52 bg-white p-2 rounded-2xl border border-[var(--line)]"></div>
          <p class="text-sm text-gray-600 mt-3 max-w-xs">Stick this at the door or send it. The tenant scans it, sees what is due and pays by M-Pesa or card — no sign-in needed. It only ever opens <b>this</b> tenant's payment.</p></div>
          <div class="grid grid-cols-2 gap-2 mt-4"><button id="ac-copy-pay" class="btn">Copy pay link</button><button id="ac-print" class="btn">Print QR card</button></div>
        </div>
        <div id="ac-login" class="hidden space-y-3">
          <p class="text-sm text-gray-600">Give the tenant these details. They sign in at the link below and must choose a new password the first time.</p>
          <div><label class="lbl" for="ac-email">Tenant email (their sign-in name)</label><input id="ac-email" type="email" class="auth-input" placeholder="tenant@email.com" autocomplete="off"/></div>
          <div class="rounded-xl bg-gray-50 border border-[var(--line)] p-3 text-sm space-y-1.5">
            <div class="flex justify-between gap-3"><span class="text-gray-500">Sign in at</span><span class="font-medium break-all text-right" id="ac-url"></span></div>
            <div class="flex justify-between gap-3"><span class="text-gray-500">First password</span><span class="font-semibold num" id="ac-pw"></span></div>
          </div>
          <p id="ac-state" class="text-sm"></p><p id="ac-err" class="text-sm text-red-600 hidden"></p>
          <button id="ac-create" class="btn btn-brand w-full">Create tenant login</button>
          <div class="grid grid-cols-2 gap-2"><button id="ac-wa" class="btn">Share on WhatsApp</button><button id="ac-copy-login" class="btn">Copy details</button></div>
        </div>
      </div></div></div>`;
    document.body.appendChild(d.firstChild);
    document.querySelectorAll("[data-ac-close]").forEach((b) => (b.onclick = () => PF.closeModal("access-modal")));
    document.querySelectorAll("[data-ac-tab]").forEach((b) => (b.onclick = () => tab(b.dataset.acTab)));
    $("ac-create").onclick = createLogin; $("ac-copy-pay").onclick = () => copy(payUrl(cur)); $("ac-print").onclick = printCard;
    $("ac-copy-login").onclick = () => copy(loginText()); $("ac-wa").onclick = () => window.open(`https://wa.me/${AI.toMsisdn(cur.phone)}?text=${encodeURIComponent(loginText())}`, "_blank", "noopener");
  }
  function tab(k) {
    document.querySelectorAll("[data-ac-tab]").forEach((b) => b.classList.toggle("on", b.dataset.acTab === k));
    $("ac-qr").classList.toggle("hidden", k !== "qr"); $("ac-login").classList.toggle("hidden", k !== "login");
  }
  async function copy(t) { try { await navigator.clipboard.writeText(t); showToast("Copied", "success"); } catch (e) { const x = document.createElement("textarea"); x.value = t; document.body.appendChild(x); x.select(); document.execCommand("copy"); x.remove(); showToast("Copied", "success"); } }
  function loginText() {
    const first = String(cur.tenantName).split(/\s+/)[0];
    return `Hi ${first}, your ${cur.propertyName || "home"} tenant account is ready.\nSign in: ${loginUrl()}\nEmail: ${$("ac-email").value.trim().toLowerCase() || cur.email || ""}\nFirst password: ${phoneDigits(cur.phone)} (your phone number — you'll choose a new one when you sign in).\nYou can see your rent, pay and get reminders there.`;
  }
  function paintState() {
    const on = cur.portalActive;
    $("ac-state").innerHTML = on ? `<span class="txt-ok font-medium">● Login is active</span> — ${esc(cur.portalEmail || cur.email || "")}` : `<span class="text-gray-500">No login created yet.</span>`;
    $("ac-create").textContent = on ? "Reset login (password back to phone number)" : "Create tenant login";
  }
  async function ensureToken(l) {
    if (l.payToken) return l;
    const tok = PF.newToken(); await db.collection("leases").doc(l.id).update({ payToken: tok }); return { ...l, payToken: tok };
  }
  async function open(lease, startTab) {
    mount(); await loadQR();
    cur = await ensureToken(lease);
    $("ac-sub").textContent = `${cur.tenantName} · ${cur.houseLabel} · ${cur.roomLabels}`;
    $("ac-qr-img").innerHTML = qrSvg(payUrl(cur), 192);
    $("ac-email").value = cur.email || ""; $("ac-url").textContent = loginUrl().replace(/^https?:\/\//, ""); $("ac-pw").textContent = phoneDigits(cur.phone);
    $("ac-err").classList.add("hidden"); paintState(); tab(startTab || "qr");
    PF.openModal("access-modal");
  }
  async function createLogin() {
    const err = (m) => { $("ac-err").textContent = m; $("ac-err").classList.remove("hidden"); };
    $("ac-err").classList.add("hidden");
    const email = $("ac-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("Enter the tenant's email address.");
    if (cur.portalActive && !(await PF.confirm({ title: "Reset this tenant's login?", message: "Their password goes back to their phone number and they must choose a new one when they next sign in.", confirmText: "Reset" }))) return;
    const b = $("ac-create"); b.disabled = true; const t = b.textContent; b.textContent = "Working…";
    try {
      await apiCall("/landlord/tenant-login", { leaseId: cur.id, email });
      cur = { ...cur, email, portalActive: true, portalEmail: email };
      db.collection("tenants").doc(cur.tenantId).set({ email }, { merge: true }).catch(() => {});
      paintState(); showToast("Tenant login ready — share the details", "success");
    } catch (e) { err(e.message || "Could not create the login"); }
    finally { b.disabled = false; if (!cur.portalActive) b.textContent = t; else paintState(); }
  }
  function printCard() {
    const w = window.open("", "_blank"); if (!w) return showToast("Allow pop-ups to print", "error");
    const biz = (PF.profile && PF.profile.businessName) || "PropFlow KE";
    w.document.write(`<!doctype html><title>Pay rent</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px}h1{margin:0 0 4px;font-size:28px}p{color:#444;margin:6px 0}.q{width:320px;margin:24px auto}.b{border:2px solid #111;border-radius:20px;display:inline-block;padding:28px 36px}</style>
      <div class="b"><p style="font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#E11D48">${esc(biz)}</p><h1>Scan to pay rent</h1><p>${esc(cur.houseLabel || "")} · ${esc(cur.roomLabels || "")}</p><div class="q">${qrSvg(payUrl(cur), 320)}</div><p>Pay with M-Pesa or card. No sign-in needed.</p></div><script>onload=()=>setTimeout(()=>print(),300)<\/script>`);
    w.document.close();
  }
  window.Access = { open };
})();
