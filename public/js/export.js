/** PropFlow KE — data export: CSV (opens in Excel) and full JSON backup. */
(function () {
  const B = PFBilling;
  function ensure() { return new Promise((res) => { let done = false; PF.watch(["properties", "houses", "rooms", "leases", "payments", "tenants", "maintenance"], (m) => { if (!done) { done = true; res(m); } }); }); }
  const cell = (v) => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function csv(name, head, rows) {
    download(`PropFlow_${name}_${B.toISO(new Date())}.csv`, "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
    showToast(`${rows.length} row${rows.length === 1 ? "" : "s"} exported — opens in Excel`, "success");
  }
  const iso = (d) => (d ? B.toISO(d) : "");
  async function tenants() {
    const m = await ensure();
    csv("Tenants", ["Tenant", "Phone", "Email", "Property", "House", "Room", "Tenancy", "Monthly rent (KSh)", "Deposit held (KSh)", "Move-in", "Rent due day", "Status", "Days overdue", "Owing (KSh)", "Move-out"],
      m.leases.map((l) => [l.tenantName, l.phone, l.email, l.propertyName, l.houseLabel, l.roomLabels, l.mode, l.rent, l.depositPaid || l.deposit, l.move_in_date, l.billingDay, l.status === "ENDED" ? "MOVED OUT" : l.ev.status, l.ev ? l.ev.daysLate : "", l.ev ? l.ev.owed : "", l.move_out_date || ""]));
  }
  async function payments() {
    const m = await ensure();
    csv("Payments", ["Date", "Tenant", "House", "Type", "Billing cycle", "Provider", "Reference", "M-Pesa receipt", "Amount (KSh)", "Status", "Verified"],
      m.payments.map((p) => [iso(m.dateOf(p)), p.tenantName, p.houseLabel, p.type || "RENT", p.billing_cycle, p.provider || p.method, p.provider_ref, p.mpesa_receipt, p.amount, p.status, p.verified === false ? "no" : "yes"]));
  }
  async function rooms() {
    const m = await ensure();
    csv("Rooms", ["Property", "House", "Room", "Tier", "Rent (KSh)", "Status", "Tenant"],
      m.rooms.map((r) => [(m.propById[r.propertyId] || {}).name, (m.houseById[r.houseId] || {}).label, r.label, r.tier, r.rent, r.status === "OCCUPIED" ? "OCCUPIED" : "VACANT", r.tenantName || ""]));
  }
  const clean = (v) => (v && v.toDate ? v.toDate().toISOString() : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);
  /** Reads straight from Firestore (not the cache) so the backup is complete. */
  async function backup() {
    const uid = auth.currentUser.uid, out = { app: "PropFlow KE", version: 2, exportedAt: new Date().toISOString(), uid, collections: {} };
    for (const c of ["properties", "houses", "rooms", "leases", "tenants", "payments", "maintenance"]) {
      const s = await db.collection(c).where("ownerId", "==", uid).get();
      out.collections[c] = s.docs.map((d) => ({ id: d.id, ...clean(d.data()) }));
    }
    const u = await db.collection("users").doc(uid).get(); const prof = clean(u.data() || {}); delete prof.avatar; out.profile = prof;
    download(`PropFlow_Backup_${B.toISO(new Date())}.json`, JSON.stringify(out, null, 2), "application/json");
    showToast("Full backup downloaded — keep it somewhere safe", "success");
  }
  window.Export = { tenants, payments, rooms, backup };
})();
