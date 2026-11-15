/**
 * PropFlow KE — Anniversary Billing Engine (pure, dependency-free, unit-tested).
 *
 * Rules
 *  - Rent is due monthly on the day-of-month the tenant moved in (clamped to the
 *    last day of shorter months: 31 Jan -> 28/29 Feb).
 *  - At move-in the tenant pays the DEPOSIT (1x rent) AND the first month's rent. Cycle 1 is due ON the move-in
 *    day; the next rent falls due one month later.
 *  - Rent payments are allocated oldest-cycle-first. A cycle is LOCKED once fully paid.
 *  - Status:
 *      OVERDUE   a due date has passed (strictly) with balance > 0
 *      DUE_SOON  next due date is today..3 days away and that cycle is not fully paid
 *      PAID      everything billed is settled (cycle locked)
 *  - Deposit = 1 x monthly rent of the leased room / whole house.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PFBilling = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DUE_SOON_DAYS = 3;
  const DAY = 86400000;

  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseISO(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function startOfDay(d) { d = d || new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); } // b - a

  /** Due date of the n-th rent cycle (n >= 1). Cycle 1 is due on the move-in day itself. */
  function dueDate(moveIn, n) {
    const mi = parseISO(moveIn);
    const total = mi.getMonth() + (n - 1);
    const y = mi.getFullYear() + Math.floor(total / 12);
    const m0 = ((total % 12) + 12) % 12;
    return new Date(y, m0, Math.min(mi.getDate(), daysInMonth(y, m0)));
  }
  const cycleKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const cycleLabel = (d) => d.toLocaleDateString("en-KE", { month: "long", year: "numeric" });

  /** Number of cycles whose due date is strictly before `today`. */
  function pastDueCount(moveIn, today) {
    let n = 0;
    while (dueDate(moveIn, n + 1) < today) { n++; if (n > 1200) break; }
    return n;
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /** Is a payment a rent payment that counts toward cycles? */
  function isRent(p) {
    return (p.type || "RENT") === "RENT" && (p.status || "success") === "success";
  }

  /**
   * Evaluate a lease at `today`.
   * @param {{move_in_date:string, rent:number}} lease
   * @param {Array} payments payments belonging to this lease (any type)
   */
  function evaluate(lease, payments, today) {
    today = startOfDay(today);
    const rent = Number(lease.rent) || 0;
    const mi = lease.move_in_date;
    const paid = (payments || []).filter(isRent).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const past = pastDueCount(mi, today);
    const billedLate = past * rent;
    const outstandingLate = Math.max(0, billedLate - paid);

    const nextIdx = past + 1;
    const nextDue = dueDate(mi, nextIdx);
    const daysUntil = daysBetween(today, nextDue);
    const credit = Math.max(0, paid - billedLate);
    const nextBalance = Math.max(0, rent - credit);
    const maxPayable = Math.max(0, (past + 1) * rent - paid);
    const locked = maxPayable <= 0; // next cycle fully paid -> no duplicate billing

    // oldest unpaid cycle (target for the next payment)
    const targetIdx = rent > 0 ? Math.min(Math.floor(paid / rent) + 1, nextIdx) : nextIdx;
    const targetDue = dueDate(mi, targetIdx);

    let status, daysLate = 0, owed = 0, label, tone;
    if (outstandingLate > 0) {
      status = "OVERDUE";
      const oldestUnpaid = dueDate(mi, Math.floor(paid / rent) + 1);
      daysLate = Math.max(1, daysBetween(oldestUnpaid, today));
      owed = outstandingLate;
      label = `${daysLate} day${daysLate === 1 ? "" : "s"} overdue — ${fmt(owed)}`;
      tone = "late";
    } else if (nextBalance > 0 && daysUntil <= DUE_SOON_DAYS) {
      status = "DUE_SOON";
      owed = nextBalance;
      label = daysUntil === 0 ? `Due today — ${fmt(owed)}` : `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"} — ${fmt(owed)}`;
      tone = "due";
    } else {
      status = "PAID";
      label = locked ? `Paid through ${cycleLabel(nextDue)}` : `Paid · next due ${fmtDate(nextDue)}`;
      tone = "paid";
    }
    return {
      status, tone, label, daysLate, owed, paid, rent,
      outstandingLate, nextDue, nextDueKey: cycleKey(nextDue), daysUntil, nextBalance,
      maxPayable, locked, targetCycleKey: cycleKey(targetDue), targetDue,
      cyclesBilled: past, billingDay: parseISO(mi).getDate()
    };
  }

  function fmt(n) {
    n = Number(n) || 0;
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    return "KSh " + n.toLocaleString("en-KE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function fmtDate(d) { return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }); }

  /**
   * Chronological ledger with running balance (rent only; deposit shown but never
   * affects the balance). Charges for cycles due on/before `today` are included.
   */
  function ledger(lease, payments, today) {
    today = startOfDay(today);
    const rows = [];
    const rent = Number(lease.rent) || 0;
    const n = pastDueCount(lease.move_in_date, new Date(today.getTime() + DAY)); // include due-today
    for (let i = 1; i <= n; i++) {
      const d = dueDate(lease.move_in_date, i);
      rows.push({ date: d, kind: "CHARGE", desc: `Rent — ${cycleLabel(d)}`, debit: rent, credit: 0 });
    }
    (payments || []).filter((p) => (p.status || "success") === "success").forEach((p) => {
      const d = p.paidAt ? parseISO(p.paidAt) : p.createdAt && p.createdAt.toDate ? startOfDay(p.createdAt.toDate()) : today;
      const type = p.type || "RENT";
      const via = p.mpesa_receipt ? `M-Pesa ${p.mpesa_receipt}` : p.provider_ref ? `${p.provider || p.method || ""} ${p.provider_ref}`.trim() : (p.provider || p.method || "Manual");
      rows.push({
        date: d, kind: type === "DEPOSIT" ? "DEPOSIT" : "PAYMENT",
        desc: type === "DEPOSIT" ? `Security deposit received (${via})` : `Payment received (${via})`,
        debit: 0, credit: type === "DEPOSIT" ? 0 : Number(p.amount) || 0,
        memo: type === "DEPOSIT" ? Number(p.amount) || 0 : null
      });
    });
    const order = { DEPOSIT: 0, CHARGE: 1, PAYMENT: 2 };
    rows.sort((a, b) => a.date - b.date || order[a.kind] - order[b.kind]);
    let bal = 0;
    rows.forEach((r) => { bal += r.debit - r.credit; r.balance = bal; });
    return rows;
  }

  /** Whole-house rent = sum of room rents; deposit = 1x rent. */
  const depositFor = (rent) => Number(rent) || 0;

  const CATEGORIES = {
    "3BR_TIERED": {
      label: "3-Bedroom (tiered)",
      rooms: [ { label: "Room 1", tier: "Large", rent: 9500 }, { label: "Room 2", tier: "Medium", rent: 8500 }, { label: "Room 3", tier: "Small", rent: 7500 } ]
    },
    "2BR_FIXED": {
      label: "2-Bedroom (fixed)",
      rooms: [ { label: "Room 1", tier: "Standard", rent: 9000 }, { label: "Room 2", tier: "Standard", rent: 9000 } ]
    },
    "SINGLE": {
      label: "Single unit / other",
      rooms: [ { label: "Unit", tier: "Standard", rent: 0 } ]
    }
  };
  const wholeHouseRent = (cat) => CATEGORIES[cat].rooms.reduce((s, r) => s + r.rent, 0);

  return { evaluate, ledger, dueDate, cycleKey, cycleLabel, pastDueCount, parseISO, toISO, startOfDay, daysBetween,
           ordinal, fmt, fmtDate, depositFor, CATEGORIES, wholeHouseRent, DUE_SOON_DAYS, isRent };
});
