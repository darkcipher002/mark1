/**
 * PropFlow KE — realtime data store.
 * Uses Firestore onSnapshot listeners on top of IndexedDB persistence:
 *   - first paint comes from the local cache (no network wait)
 *   - local writes appear instantly (optimistic UI via latency compensation)
 *   - every query is a single-field `ownerId ==` filter (no composite indexes needed)
 */
(function () {
  const PF = (window.PF = window.PF || {});
  const B = window.PFBilling;
  const data = {};
  const loaded = {};
  const listeners = {};
  const subs = [];
  let raf = 0;
  let warned = false;
  let uid = null;

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      let model = null;
      subs.forEach((s) => {
        if (!s.names.every((n) => loaded[n])) return;
        model = model || PF.model();
        s.cb(model);
      });
    });
  }

  function listen(name) {
    if (listeners[name]) return;
    listeners[name] = db.collection(name).where("ownerId", "==", uid).onSnapshot(
      (snap) => { data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); loaded[name] = true; schedule(); },
      (err) => {
        console.error(name, err);
        loaded[name] = true; data[name] = data[name] || [];
        if (!warned) { warned = true; showToast("Could not read " + name + ". Deploy firestore.rules (firebase deploy --only firestore:rules).", "error"); }
        schedule();
      }
    );
  }

  /** PF.watch(["rooms","leases"], model => render(model)) */
  PF.watch = function (names, cb) {
    uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) return;
    subs.push({ names, cb });
    names.forEach(listen);
    schedule();
  };

  /* ---- profile (cached in sessionStorage for instant first paint) ---- */
  PF.profile = SS.get("profile", null);
  const profileCbs = [];
  PF.onProfile = (cb) => { profileCbs.push(cb); if (PF.profile) cb(PF.profile); };
  PF.startProfile = function (user) {
    db.collection("users").doc(user.uid).onSnapshot((d) => {
      if (!d.exists) return;
      const p = d.data();
      PF.profile = { ...p, avatar: p.avatar || null, trialEndsAt: p.trialEndsAt && p.trialEndsAt.toDate ? p.trialEndsAt.toDate().toISOString() : p.trialEndsAt || null, createdAt: null, updatedAt: null };
      SS.set("profile", PF.profile);
      profileCbs.forEach((cb) => cb(PF.profile));
    }, (e) => console.error("profile", e));
  };

  /** Records older than this many days move out of the busy lists into Archive views (data is never moved or deleted). */
  PF.ARCHIVE_DAYS = 30;

  const dateOf = (p) => {
    if (p.paidAt) return B.parseISO(p.paidAt);
    if (p.createdAt && p.createdAt.toDate) return B.startOfDay(p.createdAt.toDate());
    return B.startOfDay(new Date());
  };
  const tsOf = (x) => (x.createdAt && x.createdAt.seconds) || (x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() / 1000 : Date.now() / 1000);

  /** Derived, render-ready view of the whole portfolio. */
  PF.model = function () {
    const today = B.startOfDay();
    const g = (n) => data[n] || [];
    const properties = g("properties").slice().sort((a, b) => tsOf(b) - tsOf(a));
    const houses = g("houses").slice().sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
    const rooms = g("rooms").slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const tenants = g("tenants").slice().sort((a, b) => tsOf(b) - tsOf(a));
    const payments = g("payments").slice().sort((a, b) => dateOf(b) - dateOf(a) || tsOf(b) - tsOf(a));
    const maintenance = g("maintenance").slice().sort((a, b) => tsOf(b) - tsOf(a));

    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - PF.ARCHIVE_DAYS);
    const asDate = (x) => (x && x.toDate ? x.toDate() : x ? new Date(x) : null);
    payments.forEach((p) => { p.archived = dateOf(p) < cutoff; });
    maintenance.forEach((t) => { const d = asDate(t.resolvedAt) || asDate(t.updatedAt) || asDate(t.createdAt); t.archived = ["resolved", "closed"].includes(t.status) && !!d && d < cutoff; });

    const propById = Object.fromEntries(properties.map((p) => [p.id, p]));
    const houseById = Object.fromEntries(houses.map((h) => [h.id, h]));
    const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));
    const roomsByHouse = {};
    rooms.forEach((r) => (roomsByHouse[r.houseId] = roomsByHouse[r.houseId] || []).push(r));

    const payByLease = {};
    payments.forEach((p) => { if (p.leaseId) (payByLease[p.leaseId] = payByLease[p.leaseId] || []).push({ ...p, paidAtDate: dateOf(p) }); });

    const leases = g("leases").map((l) => {
      const pays = payByLease[l.id] || [];
      const ev = l.status === "ACTIVE" ? B.evaluate(l, pays, today) : null;
      const deposit = pays.filter((p) => p.type === "DEPOSIT").reduce((s, p) => s + (p.amount || 0), 0);
      const endD = l.status === "ENDED" ? (l.move_out_date ? B.parseISO(l.move_out_date) : asDate(l.endedAt)) : null;
      return { ...l, payments: pays, ev, depositPaid: deposit, archived: !!endD && endD < cutoff };
    }).sort((a, b) => tsOf(b) - tsOf(a));
    const leaseById = Object.fromEntries(leases.map((l) => [l.id, l]));
    const active = leases.filter((l) => l.status === "ACTIVE");
    const rank = { OVERDUE: 0, DUE_SOON: 1, PAID: 2 };
    const attention = active.filter((l) => l.ev.status !== "PAID").sort((a, b) => rank[a.ev.status] - rank[b.ev.status] || b.ev.daysLate - a.ev.daysLate || a.ev.daysUntil - b.ev.daysUntil);

    const vacantRooms = rooms.filter((r) => r.status !== "OCCUPIED");
    const expected = active.reduce((s, l) => s + (l.rent || 0), 0);
    const collectedMonth = payments.filter((p) => B.isRent(p) && dateOf(p).getMonth() === today.getMonth() && dateOf(p).getFullYear() === today.getFullYear()).reduce((s, p) => s + (p.amount || 0), 0);
    const arrears = active.reduce((s, l) => s + (l.ev.outstandingLate || 0), 0);
    const vacantRevenue = vacantRooms.reduce((s, r) => s + (r.rent || 0), 0);

    return { cutoff, today, properties, houses, rooms, tenants, payments, maintenance, leases, active, attention, leaseById,
      propById, houseById, roomById, roomsByHouse, vacantRooms, expected, collectedMonth, arrears, vacantRevenue,
      dateOf };
  };

  /** Houses decorated with occupancy mode for UI. */
  PF.houseState = function (m, house) {
    const rs = m.roomsByHouse[house.id] || [];
    const occ = rs.filter((r) => r.status === "OCCUPIED");
    const mode = occ.length === 0 ? "VACANT" : occ.length === rs.length && rs.every((r) => r.leaseId === rs[0].leaseId) && (m.leaseById[rs[0].leaseId] || {}).mode === "WHOLE_HOUSE" ? "WHOLE_HOUSE" : "BY_ROOM";
    return { rooms: rs, occupied: occ.length, vacant: rs.length - occ.length, mode };
  };

  PF.ts = () => firebase.firestore.FieldValue.serverTimestamp();

  /** Optimistic write: UI already reflects the local write via snapshots; report the server result afterwards. */
  PF.fire = function (promise, okMsg, errPrefix) {
    if (okMsg) showToast(okMsg, "success");
    return Promise.resolve(promise).catch((e) => { console.error(e); showToast((errPrefix || "Save failed") + ": " + (e.message || "permission denied"), "error"); throw e; });
  };
})();
