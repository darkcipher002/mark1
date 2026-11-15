/* PropFlow Home — tenant app. Talks only to /api/tenant/* ; never loads anything from the landlord side. */
(function () {
  const CFG = {
  apiKey: "AIzaSyDhakDIUgpD5OlJi2I0DE0axe8J7DYN9X4",
  authDomain: "isproj-f0bf2.firebaseapp.com",
  projectId: "isproj-f0bf2",
  storageBucket: "isproj-f0bf2.firebasestorage.app",
  messagingSenderId: "916554340072",
  appId: "1:916554340072:web:2b258a64c309258864db5d",
  measurementId: "G-4YK4CPH63G"
};
  firebase.initializeApp(CFG);
  const auth = firebase.auth(); auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  const $app = document.getElementById("app");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => "KSh " + (Number(n) || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 });
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fd = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const LS = { get(k) { try { return JSON.parse(localStorage.getItem("ph:" + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem("ph:" + k, JSON.stringify(v)); } catch (e) {} }, clear() { try { Object.keys(localStorage).filter((k) => k.startsWith("ph:")).forEach((k) => localStorage.removeItem(k)); } catch (e) {} } };
  let toastT; function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 4200); }
  let D = null, tab = "home", deferredInstall = null, signingIn = false, lastPw = null;

  async function api(path, body) {
    const u = auth.currentUser; const tok = u ? await u.getIdToken() : "";
    const r = await fetch("/api/tenant" + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(body || {}) });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error((j && j.error) || "Something went wrong. Please try again."); e.status = r.status; e.code = j && j.code; throw e; }
    return j;
  }
  const spin = (b, on, t) => { b.disabled = on; if (on) { b.dataset.t = b.textContent; b.textContent = t || "Please wait…"; } else b.textContent = b.dataset.t || b.textContent; };

  /* ---------------- shell pieces ---------------- */
  const logo = `<div class="flex items-center gap-3 justify-center mb-6"><div class="w-11 h-11 rounded-2xl bg-brand-600 text-white flex items-center justify-center font-bold text-lg">P</div><span class="font-bold text-xl">My Home</span></div>`;
  const eye = (id) => `<button type="button" data-eye="${id}" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500">Show</button>`;
  function wireEyes() { document.querySelectorAll("[data-eye]").forEach((b) => (b.onclick = () => { const i = document.getElementById(b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Show" : "Hide"; })); }

  /* ---------------- login ---------------- */
  function viewLogin(msg) {
    $app.innerHTML = `<div class="p-5 pt-14">${logo}<div class="card p-6"><h1 class="text-2xl font-bold">Welcome home</h1><p class="text-sm text-gray-500 mt-1">Sign in to see your rent, pay and get reminders.</p>
      ${msg ? `<p class="mt-4 text-sm rounded-xl bg-[var(--due-bg)] text-[var(--due)] p-3">${esc(msg)}</p>` : ""}
      <form id="lf" class="mt-5 space-y-4" novalidate><div><label class="lbl" for="em">Email</label><input id="em" type="email" class="auth-input" autocomplete="username" inputmode="email" autocapitalize="off"/></div>
      <div><label class="lbl" for="pw">Password</label><div class="relative"><input id="pw" type="password" class="auth-input pr-16" autocomplete="current-password"/>${eye("pw")}</div><p class="hint">First time? Your password is your phone number, e.g. 0712345678.</p></div>
      <p id="er" class="text-sm txt-late hidden"></p><button id="go" class="btn-primary w-full">Sign in</button></form>
      <button id="fg" class="block mx-auto mt-4 text-sm font-semibold text-brand-600">Forgot password?</button></div>
      <button id="inst" class="hidden btn w-full mt-4">Install this app on your phone</button></div>`;
    wireEyes(); const em = $q("em"); em.value = LS.get("email") || "";
    const err = (m) => { const e = $q("er"); e.textContent = m; e.classList.remove("hidden"); };
    $q("lf").onsubmit = async (e) => {
      e.preventDefault(); const email = em.value.trim().toLowerCase(), pw = $q("pw").value;
      if (!email || !pw) return err("Enter your email and password.");
      const b = $q("go"); spin(b, true, "Signing in…"); signingIn = true;
      try { await signIn(email, pw); LS.set("email", email); await boot(); }
      catch (x) { signingIn = false; spin(b, false); err(x.code === "tenant/inactive" ? x.message : x.code === "auth/too-many-requests" ? "Too many attempts. Wait a few minutes and try again." : x.code === "auth/network-request-failed" ? "No internet connection." : "Email or password is not right."); }
    };
    $q("fg").onclick = async () => { const email = em.value.trim().toLowerCase(); if (!email) return err("Type your email above first, then tap Forgot password."); try { await auth.sendPasswordResetEmail(email); } catch (x) {} toast("If that email has an account, a reset link is on its way."); };
    wireInstall();
  }
  const $q = (id) => document.getElementById(id);
  /** Phone-number passwords can be typed several ways; try each so a first sign-in just works. */
  function pwVariants(p) {
    const out = [p], d = p.replace(/[\s-]/g, "").replace(/^\+/, "");
    if (/^\d+$/.test(d)) { let n = d; if (n.startsWith("254")) n = "0" + n.slice(3); else if (n.length === 9) n = "0" + n; out.push(n); }
    return [...new Set(out)];
  }
  async function signIn(email, pw) {
    let last;
    for (const v of pwVariants(pw)) {
      try { const c = await auth.signInWithEmailAndPassword(email, v); lastPw = v; const t = await c.user.getIdTokenResult(true); if (!t.claims || t.claims.role !== "tenant") { await auth.signOut(); const e = new Error("bad"); e.code = "auth/invalid-credential"; throw e; } return c; }
      catch (e) { last = e; if (!/invalid|wrong|user-not-found|credential/.test(e.code || "")) break; }
    }
    throw last;
  }

  /* ---------------- first sign-in: choose a new password ---------------- */
  function viewSetPassword(first) {
    $app.innerHTML = `<div class="p-5 pt-14">${logo}<div class="card p-6"><h1 class="text-2xl font-bold">Hi ${esc(first || "there")} 👋</h1><p class="text-sm text-gray-500 mt-1">For your security, choose a new password before you continue.</p>
      <form id="sp" class="mt-5 space-y-4" novalidate><div><label class="lbl" for="n1">New password</label><div class="relative"><input id="n1" type="password" class="auth-input pr-16" autocomplete="new-password"/>${eye("n1")}</div><p class="hint">At least 8 characters. Not your phone number.</p></div>
      <div><label class="lbl" for="n2">Confirm new password</label><div class="relative"><input id="n2" type="password" class="auth-input pr-16" autocomplete="new-password"/>${eye("n2")}</div></div>
      <p id="er" class="text-sm txt-late hidden"></p><button id="go" class="btn-primary w-full">Save and continue</button></form>
      <button id="so" class="block mx-auto mt-4 text-sm text-gray-500">Sign out</button></div></div>`;
    wireEyes(); $q("so").onclick = signOut;
    $q("sp").onsubmit = async (e) => {
      e.preventDefault(); const a = $q("n1").value, b2 = $q("n2").value, er = $q("er"); er.classList.add("hidden");
      const bad = (m) => { er.textContent = m; er.classList.remove("hidden"); };
      if (a.length < 8) return bad("Use at least 8 characters."); if (a !== b2) return bad("The two passwords don't match.");
      const btn = $q("go"); spin(btn, true, "Saving…");
      try { await api("/set-password", { newPassword: a }); const email = auth.currentUser.email; signingIn = true; await auth.signOut(); await auth.signInWithEmailAndPassword(email, a); lastPw = a; toast("Password updated"); await boot(); }
      catch (x) { signingIn = false; spin(btn, false); bad(x.message); if (x.code === "account_inactive") signOut(); }
    };
  }

  /* ---------------- main app ---------------- */
  const ICON = { home: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6", pay: "M2 8a2 2 0 012-2h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8zm0 2h20M6 15h4", house: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", bell: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0", me: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" };
  const ic = (k) => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="${ICON[k]}"/></svg>`;
  const TABS = [["home", "Home"], ["pay", "Payments"], ["house", "My home"], ["bell", "Alerts"], ["me", "Account"]];
  const tone = { PAID: "paid", DUE_SOON: "due", OVERDUE: "late" };

  function render() {
    if (!D) return;
    const body = { home: vHome, pay: vPay, house: vHouse, bell: vAlerts, me: vMe }[tab]();
    $app.innerHTML = `<header class="px-5 pt-6 pb-2 flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-sm">P</div><span class="font-bold">My Home</span></div><span class="text-xs text-gray-400">${esc(D.landlord.business)}</span></header>
      <main class="px-5 pb-28 pt-2 space-y-4">${body}</main>
      <nav id="tabbar" class="fixed bottom-0 inset-x-0 bg-white border-t border-[var(--line)] z-40"><div class="max-w-md mx-auto flex">${TABS.map(([k, l]) => `<button class="tb ${tab === k ? "on" : ""}" data-tab="${k}" style="position:relative">${ic(k)}${l}${k === "bell" && D.unread ? `<span style="position:absolute;top:4px;right:calc(50% - 20px)" class="min-w-[16px] h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">${D.unread}</span>` : ""}</button>`).join("")}</div></nav>`;
    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); if (tab === "bell") loadAlerts(); }));
    const g = (id, fn) => { const el = $q(id); if (el) el.onclick = fn; };
    g("pay-now", payNow); g("out", signOut); g("stmt", statement); g("pwc", changePw); g("inst2", install); g("push2", togglePush); g("refresh", () => refresh(true));
    document.querySelectorAll("[data-rcpt]").forEach((b) => (b.onclick = () => receipt(b.dataset.rcpt)));
    if (tab === "me") pushState();
  }
  function hero() {
    const e = D.ev, t = tone[e.status] || "paid", owing = e.status === "OVERDUE" ? e.owed : e.nextBalance;
    const first = D.first || "there", hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    let big, sub;
    if (e.locked || !(owing > 0)) { big = "All paid up"; sub = `Next rent ${fmt(D.lease.rent)} is due on ${fd(e.nextDue)}.`; }
    else { big = fmt(owing); sub = e.label; }
    return `<p class="text-gray-500">${greet}, <b class="text-gray-900">${esc(first)}</b></p>
      <div class="card p-6"><span class="pill pill-${t}">${e.status === "OVERDUE" ? "OVERDUE" : e.status === "DUE_SOON" ? "DUE SOON" : "PAID"}</span><p class="text-4xl font-extrabold mt-3 num">${big}</p><p class="text-sm mt-1 font-medium txt-${t}">${esc(sub)}</p>
      ${owing > 0 && !e.locked ? `<button id="pay-now" class="btn-primary w-full mt-6">Pay ${fmt(owing)} now</button><p class="text-xs text-gray-400 text-center mt-2">M-Pesa or card · secured by Paystack</p>` : ""}</div>`;
  }
  function vHome() {
    const l = D.lease, e = D.ev, last = D.payments.find((p) => p.type === "RENT");
    return hero() + `<div class="card divide-line"><div class="p-4 flex justify-between"><span class="text-gray-500 text-sm">Your home</span><span class="font-semibold text-sm text-right">${esc(l.houseLabel)} · ${esc(l.roomLabels)}</span></div>
      <div class="p-4 flex justify-between"><span class="text-gray-500 text-sm">Monthly rent</span><span class="font-semibold text-sm num">${fmt(l.rent)}</span></div>
      <div class="p-4 flex justify-between"><span class="text-gray-500 text-sm">Rent is due every</span><span class="font-semibold text-sm">${ord(l.billingDay)} of the month</span></div>
      <div class="p-4 flex justify-between"><span class="text-gray-500 text-sm">Current rent period</span><span class="font-semibold text-sm text-right">${fd(D.period.start)} – ${fd(D.period.end)}</span></div>
      <div class="p-4 flex justify-between"><span class="text-gray-500 text-sm">Last payment</span><span class="font-semibold text-sm text-right">${last ? fmt(last.amount) + " · " + fd(last.paidAt) : "—"}</span></div></div>
      <button id="refresh" class="block mx-auto text-sm font-semibold text-brand-600">Refresh</button>`;
  }
  function vPay() {
    const rows = D.payments.length ? D.payments.map((p) => `<div class="p-4 flex items-center justify-between gap-3"><div class="min-w-0"><p class="font-semibold text-sm">${p.type === "DEPOSIT" ? "Security deposit" : "Rent" + (p.billing_cycle ? " · " + p.billing_cycle : "")}</p><p class="text-xs text-gray-400">${fd(p.paidAt)}${p.mpesa_receipt || p.provider_ref ? " · " + esc(p.mpesa_receipt || p.provider_ref) : ""}</p></div><div class="text-right"><p class="font-bold text-sm num txt-paid">${fmt(p.amount)}</p><button class="text-xs font-semibold text-brand-600" data-rcpt="${esc(p.id)}">Receipt</button></div></div>`).join("") : `<div class="p-8 text-center text-sm text-gray-500">No payments yet.</div>`;
    return `<h2 class="text-xl font-bold">Payments</h2>${D.ev.nextBalance > 0 || D.ev.owed > 0 ? `<button id="pay-now" class="btn-primary w-full">Pay rent now</button>` : ""}<div class="card divide-line">${rows}</div><button id="stmt" class="btn w-full">Download my statement</button>`;
  }
  function vHouse() {
    const l = D.lease, row = (a, b) => `<div class="p-4 flex justify-between gap-4"><span class="text-gray-500 text-sm">${a}</span><span class="font-semibold text-sm text-right">${b}</span></div>`;
    return `<h2 class="text-xl font-bold">My home</h2><div class="card divide-line">${row("Property", esc(l.propertyName))}${row("House", esc(l.houseLabel))}${row("Room", esc(l.mode === "WHOLE_HOUSE" ? "Whole house" : l.roomLabels))}${row("Moved in", fd(l.move_in_date))}${row("Rent", fmt(l.rent) + " / month")}${row("Rent due", ord(l.billingDay) + " of every month")}${row("Security deposit", fmt(l.deposit))}${row("Current period", fd(D.period.start) + " – " + fd(D.period.end))}</div>
      <h3 class="font-semibold pt-2">Documents</h3><div class="card divide-line"><button id="stmt" class="w-full p-4 flex justify-between items-center text-left"><span class="text-sm font-semibold">Payment statement</span><span class="text-xs text-brand-600 font-semibold">Open</span></button>
      ${D.payments.slice(0, 5).map((p) => `<button data-rcpt="${esc(p.id)}" class="w-full p-4 flex justify-between items-center text-left"><span class="text-sm">Receipt · ${fd(p.paidAt)}</span><span class="text-xs text-brand-600 font-semibold">${fmt(p.amount)}</span></button>`).join("")}</div>`;
  }
  let notes = null;
  function vAlerts() {
    const list = notes ? (notes.length ? notes.map((n) => `<div class="p-4 ${n.read ? "" : "bg-brand-50/60"}"><p class="font-semibold text-sm">${esc(n.title)}</p><p class="text-sm text-gray-500">${esc(n.body)}</p><p class="text-[11px] text-gray-400 mt-1">${n.at ? fd(n.at) : ""}</p></div>`).join("") : `<div class="p-8 text-center text-sm text-gray-500">No alerts yet. We'll remind you before rent is due.</div>`) : `<div class="p-4"><div class="skel h-12"></div></div>`;
    return `<h2 class="text-xl font-bold">Alerts</h2><div class="card divide-line">${list}</div>`;
  }
  async function loadAlerts() { try { const r = await api("/notifications", { markRead: true }); notes = r.items; D.unread = 0; LS.set("me", D); render(); } catch (e) { if (e.code === "account_inactive") return inactive(); } }
  function vMe() {
    return `<h2 class="text-xl font-bold">Account</h2><div class="card p-4"><p class="font-semibold">${esc(D.lease.tenantName)}</p><p class="text-sm text-gray-500">${esc(D.email)}</p><p class="text-sm text-gray-500">${esc(D.lease.phone || "")}</p></div>
      <div class="card p-5 space-y-3" id="pushbox"><p class="font-semibold">Reminders on this phone</p><p class="text-sm text-gray-500" id="push-t">Get a notification a week before rent is due, and when payments are received.</p><button id="push2" class="btn btn-soft w-full">Turn on reminders</button></div>
      <div class="card p-5 space-y-3"><p class="font-semibold">Change password</p><div class="relative"><input id="p1" type="password" class="auth-input pr-16" placeholder="New password (8+ characters)" autocomplete="new-password"/>${eye("p1")}</div><button id="pwc" class="btn w-full">Update password</button></div>
      <button id="inst2" class="btn w-full hidden">Install this app on my phone</button><p id="inst-ios" class="text-xs text-gray-500 hidden text-center">On iPhone: tap Share, then “Add to Home Screen”.</p>
      <button id="out" class="btn btn-danger w-full">Sign out</button>`;
  }
  async function pushState() {
    wireEyes(); wireInstall(); const b = $q("push2"), t = $q("push-t"); if (!b) return; const st = await PFPush.state();
    if (st === "unsupported") return $q("pushbox").classList.add("hidden");
    b.disabled = st === "blocked"; b.textContent = st === "on" ? "Turn off reminders" : st === "blocked" ? "Blocked in phone settings" : "Turn on reminders";
    t.textContent = st === "on" ? "Reminders are on for this phone." : st === "blocked" ? "Allow notifications for this app in your phone settings." : t.textContent;
  }
  async function togglePush() { const b = $q("push2"); b.disabled = true; try { if ((await PFPush.state()) === "on") await PFPush.disable(); else { await PFPush.enable(); toast("Reminders are on"); } } catch (e) { toast(e.message); } pushState(); }
  async function changePw() {
    const v = $q("p1").value; if (v.length < 8) return toast("Use at least 8 characters.");
    const b = $q("pwc"); spin(b, true, "Saving…");
    try { await api("/set-password", { newPassword: v }); const em = auth.currentUser.email; signingIn = true; await auth.signOut(); await auth.signInWithEmailAndPassword(em, v); toast("Password updated"); await boot(); }
    catch (e) { signingIn = false; spin(b, false); toast(e.message); }
  }

  /* ---------------- install ---------------- */
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; wireInstall(); });
  addEventListener("appinstalled", () => { deferredInstall = null; wireInstall(); });
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  function wireInstall() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone();
    ["inst", "inst2"].forEach((id) => { const b = $q(id); if (b) { b.classList.toggle("hidden", !deferredInstall); b.onclick = install; } });
    const i = $q("inst-ios"); if (i) i.classList.toggle("hidden", !ios);
  }
  async function install() { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; wireInstall(); }

  /* ---------------- pay ---------------- */
  async function payNow() {
    const b = $q("pay-now"); spin(b, true, "Opening secure checkout…");
    try { const r = await api("/pay-init"); location.href = r.url; }
    catch (e) { spin(b, false); toast(e.message); if (e.code === "account_inactive") inactive(); }
  }
  async function verifyReturn(ref) {
    try { const r = await api("/pay-verify", { reference: ref }); toast(`Payment received — ${fmt(r.amount)}. Thank you!`); }
    catch (e) { toast("We're confirming your payment. It will show here shortly."); }
    history.replaceState(null, "", "/tenant/");
  }

  /* ---------------- documents (printable) ---------------- */
  function printable(title, html) {
    const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to open this document.");
    w.document.write(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}th{font-size:12px;color:#666}.r{text-align:right}.m{color:#666;font-size:13px}button{margin-top:20px;padding:10px 18px;font-size:15px}@media print{button{display:none}}</style>${html}<button onclick="print()">Print / Save as PDF</button>`);
    w.document.close();
  }
  function statement() {
    const l = D.lease, tot = D.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    printable("Statement", `<p class="m">${esc(D.landlord.business)}</p><h1>Payment statement</h1><p class="m">${esc(l.tenantName)} · ${esc(l.houseLabel)} · ${esc(l.roomLabels)}<br/>Rent ${fmt(l.rent)} due on the ${ord(l.billingDay)} · Generated ${fd(new Date().toISOString())}</p>
      <table><tr><th>Date</th><th>Details</th><th class="r">Amount</th></tr>${D.payments.slice().reverse().map((p) => `<tr><td>${fd(p.paidAt)}</td><td>${p.type === "DEPOSIT" ? "Security deposit" : "Rent " + (p.billing_cycle || "")} ${esc(p.mpesa_receipt || p.provider_ref || "")}</td><td class="r">${fmt(p.amount)}</td></tr>`).join("")}<tr><th colspan="2">Total paid</th><th class="r">${fmt(tot)}</th></tr></table>`);
  }
  function receipt(id) {
    const p = D.payments.find((x) => x.id === id); if (!p) return; const l = D.lease;
    printable("Receipt", `<p class="m">${esc(D.landlord.business)}</p><h1>Payment receipt</h1><p class="m">Received from ${esc(l.tenantName)}<br/>${esc(l.propertyName)} · ${esc(l.houseLabel)} · ${esc(l.roomLabels)}</p>
      <table><tr><td>Amount</td><td class="r"><b>${fmt(p.amount)}</b></td></tr><tr><td>For</td><td class="r">${p.type === "DEPOSIT" ? "Security deposit" : "Rent " + (p.billing_cycle || "")}</td></tr><tr><td>Date</td><td class="r">${fd(p.paidAt)}</td></tr><tr><td>Reference</td><td class="r">${esc(p.mpesa_receipt || p.provider_ref || "—")}</td></tr></table>`);
  }

  /* ---------------- lifecycle ---------------- */
  async function signOut() { try { await PFPush.disable(); } catch (e) {} try { await auth.signOut(); } catch (e) {} LS.clear(); D = null; notes = null; viewLogin(); }
  function inactive() { auth.signOut().catch(() => {}); LS.clear(); D = null; viewLogin("This account is no longer active. If you think this is a mistake, please contact your landlord."); }
  async function refresh(manual) {
    try { const r = await api("/me"); if (r.mustChangePassword) return viewSetPassword(r.first); D = r; LS.set("me", D); render(); if (manual) toast("Up to date"); }
    catch (e) { if (e.code === "account_inactive" || e.code === "forbidden" || e.status === 401) return inactive(); if (manual || !D) toast(navigator.onLine ? e.message : "You're offline — showing your last saved details."); }
  }
  async function boot() {
    const cached = LS.get("me"); if (cached && !cached.mustChangePassword) { D = cached; render(); }
    await refresh(); signingIn = false;
    const ref = new URLSearchParams(location.search).get("reference") || new URLSearchParams(location.search).get("trxref");
    if (ref && D) { await verifyReturn(ref); await refresh(); }
    if (D && window.PFPush) PFPush.refresh();
  }
  auth.onAuthStateChanged(async (u) => {
    if (signingIn) return; if (!u) return viewLogin();
    try { const t = await u.getIdTokenResult(); if (!t.claims || t.claims.role !== "tenant") return viewLogin(); } catch (e) {}
    boot();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && auth.currentUser && D) refresh(); });
  if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();
