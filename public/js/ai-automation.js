/**
 * PropFlow KE — AI automation layer (NVIDIA NIM, OpenAI-compatible).
 * The browser never sees the NVIDIA key: calls go to /api/ai/chat (Cloud Function) which reads NVIDIA_API_KEY
 * from the backend environment and forwards to https://integrate.api.nvidia.com/v1/chat/completions
 * with model meta/llama-3.1-8b-instruct.
 *
 *   1. M-Pesa SMS parser  -> strict JSON at temperature 0, validated against the raw SMS, regex fallback
 *   2. Smart reminders    -> instant template (<280 chars) with optional AI polish; Copy / WhatsApp / SMS
 */
(function () {
  const PF = (window.PF = window.PF || {});
  const B = window.PFBilling;

  /* ------------------------------------------------------------------ helpers */
  const MODEL = "meta/llama-3.1-8b-instruct";
  async function chat(messages, opts = {}) {
    const r = await apiCall("/ai/chat", { model: MODEL, messages, temperature: opts.temperature ?? 0, max_tokens: opts.max_tokens || 300 });
    return (r && r.content) || "";
  }
  function extractJSON(txt) {
    const m = String(txt).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON in model output");
    return JSON.parse(m[0]);
  }
  const num = (s) => { const n = parseFloat(String(s == null ? "" : s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; };
  function toISODate(s) {
    if (!s) return B.toISO(new Date());
    const m = String(s).match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
    if (!m) return B.toISO(new Date());
    let [, a, b, c] = m.map(Number);
    let y, mo, d;
    if (String(m[1]).length === 4) { y = a; mo = b; d = c; } else { d = a; mo = b; y = c < 100 ? 2000 + c : c; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return B.toISO(new Date());
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function toMsisdn(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (d.startsWith("254")) return d;
    if (d.startsWith("0")) return "254" + d.slice(1);
    if (d.length === 9) return "254" + d;
    return d;
  }

  /* ------------------------------------------------------------------ 1. M-Pesa SMS parser */
  function regexParse(sms) {
    const t = sms.replace(/\s+/g, " ").trim();
    const ref = (t.match(/\b([A-Z0-9]{10})\b(?=\s+Confirmed)/i) || t.match(/\b([A-Z]{2,3}\d[A-Z0-9]{6,8})\b/) || [])[1] || "";
    const amount = num((t.match(/Ksh\.?\s?([\d,]+(?:\.\d{1,2})?)/i) || [])[1]);
    const from = (t.match(/(?:received|sent)?\s*(?:from|by)\s+([A-Za-z][A-Za-z .'-]{2,40}?)\s+(?:\+?\d[\d*]{7,12}|on\s|\d{1,2}\/)/i) || [])[1] || "";
    const phone = (t.match(/(?:\+?254|0)[17][\d*]{8}/) || [])[0] || "";
    const date = (t.match(/\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) || [])[1] || "";
    return { mpesa_ref: ref.toUpperCase(), amount, sender_name: from.trim(), phone, date: toISODate(date) };
  }
  /** Returns {data, source: "nim"|"local"} — AI output is only trusted if it is consistent with the raw SMS. */
  async function parseMpesaSms(sms) {
    const local = regexParse(sms);
    try {
      const out = await chat([
        { role: "system", content: "You extract fields from Kenyan M-Pesa confirmation SMS messages. Reply with ONLY a JSON object, no prose, with keys: mpesa_ref (string, the transaction code), amount (number in KES), sender_name (string), phone (string as shown), date (string YYYY-MM-DD). Use null for anything not present. Never invent values." },
        { role: "user", content: sms }
      ], { temperature: 0, max_tokens: 200 });
      const j = extractJSON(out);
      const ref = String(j.mpesa_ref || "").toUpperCase().trim();
      const amount = num(j.amount);
      const compact = sms.replace(/,/g, "");
      const ok = /^[A-Z0-9]{8,12}$/.test(ref) && sms.toUpperCase().includes(ref) && amount > 0 && compact.includes(String(Math.trunc(amount)));
      if (!ok) throw new Error("AI output failed validation");
      return { source: "nim", data: { mpesa_ref: ref, amount, sender_name: String(j.sender_name || local.sender_name || "").trim(), phone: String(j.phone || local.phone || ""), date: toISODate(j.date || local.date) } };
    } catch (e) {
      if (!local.mpesa_ref || !local.amount) throw new Error("Could not read this SMS. Check that it's a full M-Pesa confirmation message.");
      return { source: "local", data: local };
    }
  }
  /** Rank active leases against parsed SMS: phone > name > amount. */
  function matchLease(parsed, leases) {
    const digits = String(parsed.phone || "").replace(/\D/g, "");
    const nat = digits.slice(-9);
    const toks = String(parsed.sender_name || "").toLowerCase().split(/\s+/).filter((x) => x.length > 1);
    return leases.map((l) => {
      let score = 0;
      const lp = String(l.phone || "").replace(/\D/g, "").slice(-9);
      const masked = /\*/.test(parsed.phone || "");
      if (nat.length === 9 && !masked && lp === nat) score += 100;
      else if (masked && lp && String(parsed.phone).replace(/\D/g, "").length >= 6) {
        const pre = String(parsed.phone).replace(/^\+?254|^0/, "").match(/^\d+/);
        const suf = String(parsed.phone).match(/\d+$/);
        if (pre && suf && lp.startsWith(pre[0]) && lp.endsWith(suf[0])) score += 80;
      }
      const nm = String(l.tenantName || "").toLowerCase();
      score += toks.filter((t) => nm.includes(t)).length * 30;
      if (l.ev && [l.ev.owed, l.ev.nextBalance, l.rent].some((x) => x && Math.abs(x - parsed.amount) < 0.5)) score += 20;
      return { lease: l, score };
    }).sort((a, b) => b.score - a.score);
  }

  /* ------------------------------------------------------------------ 2. Smart reminders */
  function reminderText(lease, link, landlord) {
    const ev = lease.ev, first = getFirstName({ fullName: lease.tenantName }, {});
    const tier = lease.roomLabels || "";
    const where = `${lease.houseLabel || ""}${tier ? " · " + tier : ""}`.trim();
    const due = B.fmtDate(ev.status === "OVERDUE" ? ev.targetDue : ev.nextDue).replace(/ \d{4}$/, "");
    const sign = landlord ? ` — ${landlord}` : "";
    const pay = link ? `Pay securely: ${link}` : "Pay via M-Pesa/Paystack and reply with the code.";
    let t;
    if (ev.status === "OVERDUE") t = `Hi ${first}, your rent of ${B.fmt(ev.owed)} for ${where} is ${ev.daysLate} day${ev.daysLate === 1 ? "" : "s"} overdue (due ${due}). ${pay} Thank you${sign}`;
    else if (ev.daysUntil === 0) t = `Hi ${first}, friendly reminder: rent of ${B.fmt(ev.owed)} for ${where} is due today. ${pay} Thank you${sign}`;
    else t = `Hi ${first}, friendly reminder: rent of ${B.fmt(ev.owed)} for ${where} is due on ${due} (in ${ev.daysUntil} day${ev.daysUntil === 1 ? "" : "s"}). ${pay} Thank you${sign}`;
    if (t.length >= 280) t = t.replace(` for ${where}`, ` for ${tier || "your room"}`);
    if (t.length >= 280) t = t.replace(/ Thank you.*$/, " Thanks");
    return t.length >= 280 ? t.slice(0, 276) + "…" : t;
  }
  async function polishReminder(text, lease) {
    const out = await chat([
      { role: "system", content: "You rewrite rent reminder messages for a Kenyan landlord to tenants: polite, warm, concise, plain English, under 270 characters. Keep every number, date, name and URL exactly as given. Output ONLY the message text." },
      { role: "user", content: text }
    ], { temperature: 0.3, max_tokens: 140 });
    const t = out.trim().replace(/^["']|["']$/g, "");
    const urls = text.match(/https?:\/\/\S+/g) || [];
    const amt = B.fmt(lease.ev.owed);
    if (t.length >= 280 || !t.includes(amt.replace("KSh ", "")) || urls.some((u) => !t.includes(u))) throw new Error("AI rewrite dropped key details");
    return t;
  }

  /* ------------------------------------------------------------------ UI */
  function ensureData() {
    return new Promise((res) => { let done = false; PF.watch(["leases", "payments", "rooms", "houses"], (m) => { if (!done) { done = true; res(m); } }); });
  }
  function mount(id, html) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("div"); el.id = id; el.className = "modal"; document.body.appendChild(el); }
    el.innerHTML = html; return el;
  }
  const $ = (root, sel) => root.querySelector(sel);

  async function openMpesaModal(opts = {}) {
    const el = mount("ai-mpesa", `
      <div class="sheet max-w-xl">
        <div class="flex items-start justify-between p-5 border-b border-[var(--line)]">
          <div><h2 class="text-lg font-semibold">Quick Confirm M-Pesa</h2><p class="text-sm text-gray-500">Paste the M-Pesa confirmation SMS — we'll read it, match the tenant and log the rent.</p></div>
          <button class="text-gray-400 text-2xl leading-none" data-close aria-label="Close">&times;</button>
        </div>
        <div class="p-5 space-y-4">
          <div><label class="lbl" for="mp-sms">M-Pesa message</label>
            <textarea id="mp-sms" rows="4" class="auth-input" placeholder="SHK7ABC123 Confirmed. Ksh8,500.00 received from JOHN KAMAU 0712345678 on 14/11/26 at 2:15 PM…"></textarea></div>
          <button id="mp-parse" class="btn btn-soft w-full">Extract details</button>
          <div id="mp-result" class="hidden space-y-4">
            <div class="flex items-center justify-between"><h3 class="text-sm font-semibold">Extracted</h3><span id="mp-src" class="pill pill-neutral"></span></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="lbl">M-Pesa code</label><input id="mp-ref" class="auth-input uppercase"/></div>
              <div><label class="lbl">Amount (KSh)</label><input id="mp-amt" type="number" min="1" step="0.01" class="auth-input"/></div>
              <div><label class="lbl">Sender</label><input id="mp-name" class="auth-input"/></div>
              <div><label class="lbl">Phone</label><input id="mp-phone" class="auth-input"/></div>
              <div class="col-span-2"><label class="lbl">Date paid</label><input id="mp-date" type="date" class="auth-input"/></div>
            </div>
            <div><label class="lbl">Tenant / room</label><select id="mp-lease" class="auth-input bg-white"></select><p id="mp-hint" class="hint"></p></div>
            <button id="mp-confirm" class="btn btn-brand w-full h-11">Confirm &amp; log payment</button>
          </div>
        </div>
      </div>`);
    el.onclick = (e) => { if (e.target.hasAttribute("data-close")) PF.closeModal("ai-mpesa"); };
    PF.openModal("ai-mpesa");
    const model = await ensureData();
    const leases = model.active;
    const sms = $(el, "#mp-sms");
    if (opts.sms) sms.value = opts.sms;
    const parseBtn = $(el, "#mp-parse");
    let current = null;

    const leaseLabel = (l) => `${l.tenantName} — ${l.houseLabel} · ${l.roomLabels}  (${l.ev.status === "PAID" ? "paid" : l.ev.label})`;
    const fillLeases = (selectedId) => {
      $(el, "#mp-lease").innerHTML = '<option value="">Select tenant…</option>' + leases.map((l) => `<option value="${l.id}" ${l.id === selectedId ? "selected" : ""}>${esc(leaseLabel(l))}</option>`).join("");
      refreshHint();
    };
    const refreshHint = () => {
      const l = leases.find((x) => x.id === $(el, "#mp-lease").value); const h = $(el, "#mp-hint");
      if (!l) { h.textContent = ""; return; }
      const c = PaymentProcessor.check(l, num($(el, "#mp-amt").value));
      h.className = "hint " + (c.ok ? "txt-paid" : "txt-late");
      h.textContent = c.ok ? `Will be applied to ${B.cycleLabel(c.ev.targetDue)} · balance after: ${B.fmt(Math.max(0, c.ev.owed - num($(el, "#mp-amt").value)))}` : c.reason;
    };
    $(el, "#mp-lease").onchange = refreshHint; $(el, "#mp-amt").oninput = refreshHint;

    parseBtn.onclick = async () => {
      if (sms.value.trim().length < 20) return showToast("Paste the full M-Pesa message first", "info");
      parseBtn.disabled = true; parseBtn.textContent = "Reading message…";
      try {
        const { data, source } = await parseMpesaSms(sms.value);
        current = data;
        $(el, "#mp-ref").value = data.mpesa_ref; $(el, "#mp-amt").value = data.amount; $(el, "#mp-name").value = data.sender_name || "";
        $(el, "#mp-phone").value = data.phone || ""; $(el, "#mp-date").value = data.date;
        $(el, "#mp-src").textContent = source === "nim" ? "AI · NVIDIA NIM" : "Read on-device";
        const ranked = matchLease(data, leases); const best = ranked[0] && ranked[0].score >= 30 ? ranked[0].lease.id : "";
        fillLeases(best);
        $(el, "#mp-result").classList.remove("hidden");
      } catch (e) { showToast(e.message, "error"); }
      finally { parseBtn.disabled = false; parseBtn.textContent = "Extract details"; }
    };

    $(el, "#mp-confirm").onclick = async () => {
      const lease = leases.find((x) => x.id === $(el, "#mp-lease").value);
      if (!lease) return showToast("Choose which tenant this payment belongs to", "error");
      const btn = $(el, "#mp-confirm"); btn.disabled = true;
      try {
        const rec = PaymentProcessor.record(lease, { amount: num($(el, "#mp-amt").value), provider: "MANUAL", mpesa_receipt: $(el, "#mp-ref").value.trim().toUpperCase(), paidAt: $(el, "#mp-date").value, note: `M-Pesa ${$(el, "#mp-ref").value.trim().toUpperCase()} from ${$(el, "#mp-name").value || "tenant"}` });
        PF.closeModal("ai-mpesa"); sms.value = "";
        const done = await PF.fire(rec, null);
        Receipts.show(done, lease);
        if (opts.onDone) opts.onDone();
      } catch (e) { showToast(e.message, "error"); }
      finally { btn.disabled = false; }
    };
  }

  /** Permanent, login-free pay page for this tenancy (secret token in the URL, checked server-side). */
  async function payLink(lease) {
    try {
      let tok = lease.payToken;
      if (!tok) { tok = PF.newToken(); await db.collection("leases").doc(lease.id).update({ payToken: tok }); }
      return `${location.origin}/pay/?l=${lease.id}&t=${tok}`;
    } catch (e) { return null; }
  }
  async function openReminder(leaseId) {
    const model = await ensureData();
    const lease = model.leaseById[leaseId];
    if (!lease || !lease.ev) return showToast("That tenancy is no longer active", "error");
    const landlord = getFirstName(PF.profile);
    const amount = lease.ev.owed > 0 ? lease.ev.owed : lease.ev.nextBalance;
    const el = mount("ai-reminder", `
      <div class="sheet max-w-lg">
        <div class="flex items-start justify-between p-5 border-b border-[var(--line)]">
          <div><h2 class="text-lg font-semibold">Remind ${esc(getFirstName({ fullName: lease.tenantName }, {}))}</h2><p class="text-sm text-gray-500">${esc(lease.houseLabel)} · ${esc(lease.roomLabels)} · <span class="txt-${lease.ev.tone} font-medium">${esc(lease.ev.label)}</span></p></div>
          <button class="text-gray-400 text-2xl leading-none" data-close aria-label="Close">&times;</button>
        </div>
        <div class="p-5 space-y-3">
          <textarea id="rm-text" rows="5" class="auth-input" maxlength="279"></textarea>
          <div class="flex items-center justify-between text-xs text-gray-500"><span id="rm-link-state">Preparing Paystack link…</span><span id="rm-count" class="num"></span></div>
          <div class="grid grid-cols-2 gap-2">
            <button id="rm-wa" class="btn btn-wa">WhatsApp</button>
            <button id="rm-sms" class="btn">SMS</button>
            <button id="rm-copy" class="btn">Copy message</button>
            <button id="rm-ai" class="btn btn-soft">Polish with AI</button>
          </div>
        </div>
      </div>`);
    el.onclick = (e) => { if (e.target.hasAttribute("data-close")) PF.closeModal("ai-reminder"); };
    const ta = $(el, "#rm-text"), cnt = $(el, "#rm-count");
    const upd = () => (cnt.textContent = ta.value.length + "/280");
    ta.oninput = upd;
    let link = null;
    ta.value = reminderText(lease, null, landlord); upd();
    PF.openModal("ai-reminder");
    payLink(lease).then((u) => {
      link = u;
      $(el, "#rm-link-state").textContent = u ? "Pay link included — tenant pays by M-Pesa or card, no login" : "Could not create the pay link";
      if (u && ta.value === reminderText(lease, null, landlord)) { ta.value = reminderText(lease, u, landlord); upd(); }
    });
    $(el, "#rm-copy").onclick = async () => { try { await navigator.clipboard.writeText(ta.value); showToast("Copied", "success"); } catch (e) { ta.select(); document.execCommand("copy"); showToast("Copied", "success"); } };
    $(el, "#rm-wa").onclick = () => window.open(`https://wa.me/${toMsisdn(lease.phone)}?text=${encodeURIComponent(ta.value)}`, "_blank", "noopener");
    $(el, "#rm-sms").onclick = () => (location.href = `sms:+${toMsisdn(lease.phone)}?body=${encodeURIComponent(ta.value)}`);
    $(el, "#rm-ai").onclick = async () => {
      const b = $(el, "#rm-ai"); b.disabled = true; b.textContent = "Polishing…";
      try { ta.value = await polishReminder(ta.value, lease); upd(); showToast("Rewritten", "success"); }
      catch (e) { showToast("AI unavailable — kept your message", "info"); }
      finally { b.disabled = false; b.textContent = "Polish with AI"; }
    };
  }

  window.AI = { payLink, chat, parseMpesaSms, regexParse, matchLease, reminderText, polishReminder, openMpesaModal, openReminder, toMsisdn };
})();
