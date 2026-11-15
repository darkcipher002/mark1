/**
 * PropFlow KE — tenancy actions shared by Properties, Tenants and Dashboard:
 *   Tenancy.openAssign({houseId?, roomId?, mode?})  — Add tenant & room assignment
 *   Tenancy.openVacate(leaseId)                    — end a tenancy; room(s) become VACANT and re-lettable
 * Rules: deposit = 1x rent; rent due on the move-in day each month; WHOLE_HOUSE locks every room under one lease.
 */
(function () {
  const PF = (window.PF = window.PF || {});
  const B = window.PFBilling;
  const $ = (id) => document.getElementById(id);

  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  PF.newToken = newToken;
  const msisdn = (phone) => { const d = String(phone || "").replace(/\D/g, ""); return d.startsWith("254") ? d : d.startsWith("0") ? "254" + d.slice(1) : d.length === 9 ? "254" + d : d; };
  PF.msisdn = msisdn;

  function ensureData() {
    return new Promise((res) => { let done = false; PF.watch(["properties", "houses", "rooms", "leases", "tenants", "payments"], (m) => { if (!done) { done = true; res(m); } }); });
  }

  const MODAL = `
  <div id="assign-modal" class="modal" aria-hidden="true">
    <form class="sheet max-w-lg" id="assign-form" novalidate>
      <div class="flex items-start justify-between p-5 border-b border-[var(--line)]">
        <div><h2 class="text-lg font-semibold">Add tenant &amp; assign room</h2><p class="text-sm text-gray-500">At move-in the tenant pays the deposit (1× rent) and the first month's rent. Rent is then due on the same day every month.</p></div>
        <button type="button" class="text-gray-400 text-2xl leading-none" data-close aria-label="Close">&times;</button>
      </div>
      <div class="p-5 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="lbl" for="a-name">Full name *</label><input id="a-name" class="auth-input" placeholder="Mary Wanjiku" autocomplete="off"/></div>
          <div><label class="lbl" for="a-phone">Phone *</label><input id="a-phone" class="auth-input" inputmode="tel" placeholder="0712 345 678"/></div>
          <div class="sm:col-span-2"><label class="lbl" for="a-email">Email <span class="text-gray-400 font-normal">(their sign-in name)</span></label><input id="a-email" type="email" class="auth-input" placeholder="tenant@email.com" autocomplete="off"/><p class="text-xs text-gray-400 mt-1">The tenant signs in to their own account with this email; their phone number is the first password.</p></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="lbl" for="a-prop">Property *</label><select id="a-prop" class="auth-input bg-white"></select></div>
          <div><label class="lbl" for="a-house">House *</label><select id="a-house" class="auth-input bg-white"></select></div>
        </div>
        <div>
          <span class="lbl">Tenancy type</span>
          <div class="grid grid-cols-2 gap-2" id="a-mode">
            <label class="flex items-center gap-2 p-3 border rounded-xl cursor-pointer has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"><input type="radio" name="a-mode" value="BY_ROOM" checked/><span class="text-sm font-medium">Single room</span></label>
            <label id="a-whole-wrap" class="flex items-center gap-2 p-3 border rounded-xl cursor-pointer has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"><input type="radio" name="a-mode" value="WHOLE_HOUSE"/><span class="text-sm font-medium">Whole house</span></label>
          </div>
        </div>
        <div id="a-room-wrap"><label class="lbl" for="a-room">Room *</label><select id="a-room" class="auth-input bg-white"></select></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="lbl" for="a-date">Move-in date *</label><input id="a-date" type="date" class="auth-input"/></div>
          <div><label class="lbl" for="a-method">Deposit + first rent received via</label><select id="a-method" class="auth-input bg-white"><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option><option value="BANK">Bank transfer</option><option value="">Not received yet</option></select></div>
        </div>
        <div id="a-ref-wrap" class="hidden"><label class="lbl" for="a-ref">M-Pesa / bank reference</label><input id="a-ref" class="auth-input uppercase" placeholder="e.g. SHK7ABC123"/></div>
        <div id="a-summary" class="rounded-xl bg-gray-50 border border-[var(--line)] p-4 text-sm space-y-1.5"></div>
        <p id="a-nopay" class="text-xs txt-due hidden">Nothing received yet — the first month will show as DUE TODAY, and OVERDUE from tomorrow.</p>
        <p id="a-err" class="text-sm txt-late hidden"></p>
      </div>
      <div class="flex gap-3 p-5 pt-0"><button type="button" class="btn flex-1" data-close>Cancel</button><button type="submit" class="btn btn-brand flex-1" id="a-save">Assign &amp; move in</button></div>
    </form>
  </div>
  <div id="vacate-modal" class="modal" aria-hidden="true">
    <form class="sheet max-w-md" id="vacate-form">
      <div class="p-5 border-b border-[var(--line)]"><h2 class="text-lg font-semibold">Vacate tenancy</h2><p class="text-sm text-gray-500" id="v-sub"></p></div>
      <div class="p-5 space-y-4">
        <div id="v-info" class="rounded-xl bg-gray-50 border border-[var(--line)] p-4 text-sm space-y-1.5"></div>
        <div><label class="lbl" for="v-date">Move-out date</label><input id="v-date" type="date" class="auth-input"/></div>
        <div><label class="lbl" for="v-dep">Security deposit</label><select id="v-dep" class="auth-input bg-white"><option value="REFUNDED">Refunded to tenant</option><option value="RETAINED">Retained (arrears / damages)</option></select></div>
        <p class="hint">The room becomes VACANT immediately and can be re-let. Other rooms in the house are not affected.</p>
      </div>
      <div class="flex gap-3 p-5 pt-0"><button type="button" class="btn flex-1" data-close>Cancel</button><button type="submit" class="btn btn-danger flex-1">Vacate</button></div>
    </form>
  </div>`;

  let mounted = false, vacateLease = null;
  function mount() {
    if (mounted) return; mounted = true;
    const w = document.createElement("div"); w.innerHTML = MODAL; document.body.append(...w.children);
    document.querySelectorAll("#assign-modal [data-close],#vacate-modal [data-close]").forEach((b) => (b.onclick = () => { PF.closeModal("assign-modal"); PF.closeModal("vacate-modal"); }));
    $("assign-form").onsubmit = submitAssign; $("vacate-form").onsubmit = submitVacate;
    ["a-prop", "a-house", "a-room", "a-date"].forEach((id) => ($(id).onchange = () => cascade(id)));
    document.querySelectorAll('input[name="a-mode"]').forEach((r) => (r.onchange = () => cascade("a-mode")));
    $("a-method").onchange = () => { $("a-ref-wrap").classList.toggle("hidden", !["MPESA", "BANK"].includes($("a-method").value)); summary(); };
  }

  let M = null;
  const vacantRoomsOf = (hid) => (M.roomsByHouse[hid] || []).filter((r) => r.status !== "OCCUPIED");
  const mode = () => document.querySelector('input[name="a-mode"]:checked').value;

  function cascade(src) {
    const props = M.properties.filter((p) => M.houses.some((h) => h.propertyId === p.id && vacantRoomsOf(h.id).length));
    if (src === "init") $("a-prop").innerHTML = props.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    if (["init", "a-prop"].includes(src)) {
      const hs = M.houses.filter((h) => h.propertyId === $("a-prop").value && vacantRoomsOf(h.id).length);
      const keep = $("a-house").value;
      $("a-house").innerHTML = hs.map((h) => { const v = vacantRoomsOf(h.id).length, t = (M.roomsByHouse[h.id] || []).length; return `<option value="${h.id}">${esc(h.label)} — ${B.CATEGORIES[h.category] ? B.CATEGORIES[h.category].label : "Unit"} (${v}/${t} rooms vacant)</option>`; }).join("");
      if (hs.some((h) => h.id === keep) && src !== "init") $("a-house").value = keep;
    }
    const house = M.houseById[$("a-house").value];
    const vac = house ? vacantRoomsOf(house.id) : [];
    const total = house ? (M.roomsByHouse[house.id] || []).length : 0;
    const wholeOk = house && vac.length === total && total > 1;
    $("a-whole-wrap").classList.toggle("opacity-40", !wholeOk);
    document.querySelector('input[value="WHOLE_HOUSE"]').disabled = !wholeOk;
    if (!wholeOk && mode() === "WHOLE_HOUSE") document.querySelector('input[value="BY_ROOM"]').checked = true;
    if (total === 1) $("a-mode").classList.add("hidden"); else $("a-mode").classList.remove("hidden");
    const keepRoom = $("a-room").value;
    $("a-room").innerHTML = vac.map((r) => `<option value="${r.id}">${esc(r.label)} · ${esc(r.tier)} — ${B.fmt(r.rent)}/mo</option>`).join("");
    if (vac.some((r) => r.id === keepRoom)) $("a-room").value = keepRoom;
    $("a-room-wrap").classList.toggle("hidden", mode() === "WHOLE_HOUSE");
    summary();
  }

  function selection() {
    const house = M.houseById[$("a-house").value]; if (!house) return null;
    let rooms, rent;
    if (mode() === "WHOLE_HOUSE") { rooms = M.roomsByHouse[house.id]; rent = rooms.reduce((s, r) => s + (r.rent || 0), 0); }
    else { const r = M.roomById[$("a-room").value]; rooms = r ? [r] : []; rent = r ? r.rent || 0 : 0; }
    return { house, rooms, rent };
  }
  function summary() {
    const s = selection(), date = $("a-date").value;
    if (!s || !s.rooms.length) { $("a-summary").innerHTML = '<span class="text-gray-500">No vacant rooms available — add a house or vacate a room first.</span>'; return; }
    const mi = date ? B.parseISO(date) : null;
    const row = (k, v, strong) => `<div class="flex justify-between gap-3"><span class="text-gray-500">${k}</span><span class="${strong ? "font-semibold" : "font-medium"} num text-right">${v}</span></div>`;
    $("a-summary").innerHTML = row("First month's rent", B.fmt(s.rent)) + row("Security deposit (1× rent)", B.fmt(B.depositFor(s.rent))) +
      `<div class="border-t border-[var(--line)] pt-1.5 mt-1">${row("Total due at move-in", B.fmt(s.rent + B.depositFor(s.rent)), true)}</div>` +
      (mi ? row("Then rent is due on the", `${B.ordinal(mi.getDate())} of every month`) + row("Next rent due", B.fmtDate(B.dueDate(date, 2))) : "");
    const noPay = !$("a-method").value; $("a-nopay").classList.toggle("hidden", !noPay);
  }

  async function openAssign(pre = {}) {
    mount(); M = await ensureData();
    if (!M.properties.length || !M.houses.some((h) => vacantRoomsOf(h.id).length)) {
      return showToast(M.properties.length ? "No vacant rooms. Add a house on the Properties page or vacate a room." : "Add a property with houses first.", "info");
    }
    $("assign-form").reset(); $("a-err").classList.add("hidden"); $("a-ref-wrap").classList.add("hidden");
    $("a-date").value = B.toISO(new Date());
    cascade("init");
    if (pre.houseId && M.houseById[pre.houseId]) { $("a-prop").value = M.houseById[pre.houseId].propertyId; cascade("a-prop"); $("a-house").value = pre.houseId; cascade("a-house"); }
    if (pre.mode === "WHOLE_HOUSE" && !document.querySelector('input[value="WHOLE_HOUSE"]').disabled) { document.querySelector('input[value="WHOLE_HOUSE"]').checked = true; cascade("a-mode"); }
    if (pre.roomId && vacantRoomsOf($("a-house").value).some((r) => r.id === pre.roomId)) { $("a-room").value = pre.roomId; summary(); }
    PF.openModal("assign-modal");
  }

  function submitAssign(e) {
    e.preventDefault();
    const err = (m) => { $("a-err").textContent = m; $("a-err").classList.remove("hidden"); };
    const name = $("a-name").value.trim().split(/\s+/).map(capitalize).join(" "), phone = $("a-phone").value.trim(), email = $("a-email").value.trim().toLowerCase(), date = $("a-date").value;
    const s = selection();
    if (!name) return err("Enter the tenant's full name.");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("That email address does not look right.");
    if (!/^(?:\+?254|0)?[17]\d{8}$/.test(phone.replace(/\s+/g, ""))) return err("Enter a valid Kenyan phone number, e.g. 0712 345 678.");
    if (!s || !s.rooms.length) return err("Choose a house and room.");
    if (!date) return err("Choose the move-in date.");
    if (s.rooms.some((r) => r.status === "OCCUPIED")) return err("That room was just taken. Pick another.");
    if (s.rent <= 0) return err("This room has no rent set. Set the rent on the Properties page first.");
    const uid = auth.currentUser.uid, ts = PF.ts();
    const prop = M.propById[s.house.propertyId];
    const phoneN = "+" + msisdn(phone);
    const existing = M.tenants.find((t) => t.phone === phoneN);
    const tenantRef = existing ? db.collection("tenants").doc(existing.id) : db.collection("tenants").doc();
    const leaseRef = db.collection("leases").doc();
    const roomLabels = s.rooms.length > 1 ? s.rooms.map((r) => `${r.label} (${r.tier})`).join(" + ") : `${s.rooms[0].label} · ${s.rooms[0].tier}`;
    const lease = {
      ownerId: uid, tenantId: tenantRef.id, tenantName: name, phone: phoneN, email: email || null,
      propertyId: s.house.propertyId, propertyName: prop ? prop.name : "", houseId: s.house.id, houseLabel: s.house.label, category: s.house.category,
      mode: mode(), roomIds: s.rooms.map((r) => r.id), roomLabels, rent: s.rent, deposit: B.depositFor(s.rent),
      move_in_date: date, billingDay: B.parseISO(date).getDate(), status: "ACTIVE", depositStatus: $("a-method").value ? "HELD" : "PENDING", currency: "KES", payToken: newToken(), createdAt: ts
    };
    const batch = db.batch();
    batch.set(tenantRef, { ownerId: uid, fullName: name, phone: phoneN, email: email || null, activeLeaseId: leaseRef.id, status: "active", ...(existing ? {} : { createdAt: ts }) }, { merge: true });
    batch.set(leaseRef, lease);
    s.rooms.forEach((r) => batch.update(db.collection("rooms").doc(r.id), { status: "OCCUPIED", leaseId: leaseRef.id, tenantId: tenantRef.id, tenantName: name }));
    const dm = $("a-method").value;
    if (dm) {
      const ref = $("a-ref").value.trim().toUpperCase();
      const doc = PaymentProcessor.buildDoc({ ...lease, id: leaseRef.id, payments: [] }, { amount: lease.deposit, type: "DEPOSIT", provider: "MANUAL", mpesa_receipt: dm === "MPESA" && ref ? ref : null, provider_ref: dm === "BANK" && ref ? ref : null, paidAt: date, note: `Security deposit (${dm.toLowerCase()})` });
      batch.set(db.collection("payments").doc(), doc);
      // first month's rent is paid together with the deposit, so cycle 1 is settled and locked from day one
      const rentDoc = PaymentProcessor.buildDoc({ ...lease, id: leaseRef.id, payments: [] }, { amount: lease.rent, type: "RENT", provider: "MANUAL", mpesa_receipt: dm === "MPESA" && ref ? ref : null, provider_ref: dm === "BANK" && ref ? ref : null, paidAt: date, note: `First month's rent at move-in (${dm.toLowerCase()})` });
      batch.set(db.collection("payments").doc(), rentDoc);
    }
    PF.closeModal("assign-modal");
    PF.fire(batch.commit(), `${getFirstName({ fullName: name }, {})} moved into ${s.house.label} — next rent due every ${B.ordinal(B.parseISO(date).getDate())}`, "Could not assign tenant")
      .then(() => PF.openAccess({ ...lease, id: leaseRef.id }, email ? "login" : "qr")).catch(() => {});
  }

  async function openVacate(leaseId) {
    mount(); M = await ensureData();
    const l = M.leaseById[leaseId]; if (!l || l.status !== "ACTIVE") return showToast("Tenancy already ended", "info");
    vacateLease = l;
    $("v-sub").textContent = `${l.tenantName} · ${l.houseLabel} · ${l.roomLabels}`;
    $("v-date").value = B.toISO(new Date());
    const arrears = l.ev.outstandingLate;
    $("v-info").innerHTML = `<div class="flex justify-between"><span class="text-gray-500">Deposit held</span><span class="font-medium num">${B.fmt(l.depositPaid)}</span></div>
      <div class="flex justify-between"><span class="text-gray-500">Unpaid rent</span><span class="font-medium num ${arrears ? "txt-late" : ""}">${B.fmt(arrears)}</span></div>`;
    $("v-dep").value = arrears > 0 ? "RETAINED" : "REFUNDED";
    PF.openModal("vacate-modal");
  }
  function submitVacate(e) {
    e.preventDefault(); const l = vacateLease; if (!l) return;
    const batch = db.batch(), ts = PF.ts();
    batch.update(db.collection("leases").doc(l.id), { status: "ENDED", move_out_date: $("v-date").value, depositStatus: $("v-dep").value, endedAt: ts });
    l.roomIds.forEach((id) => batch.update(db.collection("rooms").doc(id), { status: "VACANT", leaseId: null, tenantId: null, tenantName: null }));
    batch.set(db.collection("tenants").doc(l.tenantId), { status: "former", activeLeaseId: null }, { merge: true });
    PF.closeModal("vacate-modal");
    PF.fire(batch.commit(), `${l.roomLabels} is now vacant and ready to re-let`, "Could not vacate")
      .then(() => { if (l.portalUid || l.portalActive) apiCall("/landlord/tenant-deactivate", { leaseId: l.id }).catch(() => showToast("Moved out, but the tenant's app login could not be switched off yet. It will switch off automatically overnight.", "info")); }).catch(() => {});
  }

  /** Lazily loads access.js (tenant login + pay QR) the first time it is needed. */
  PF.openAccess = (lease, tab) => new Promise((res, rej) => {
    if (window.Access) return res(window.Access.open(lease, tab));
    const s = document.createElement("script"); s.src = "/js/access.js"; s.onload = () => res(window.Access.open(lease, tab)); s.onerror = () => rej(new Error("Could not load")); document.head.appendChild(s);
  });
  window.Tenancy = { openAssign, openVacate };
})();
