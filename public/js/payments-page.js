/* PropFlow KE — Rent & payments page */
(function () {
  const B = PFBilling;
  const $ = (id) => document.getElementById(id);
  let M = null, filter = "all", q = "", view = "recent", visible = [];

  PF.boot(() => {
    PF.watch(["leases", "payments", "rooms", "houses", "properties"], (m) => { const first = !M; M = m; render(); fillLeases(); if (first) afterLoad(); });
  });

  function afterLoad() {
    const sp = new URLSearchParams(location.search);
    const ref = sp.get("reference") || sp.get("trxref");
    if (ref) { // returned from a Paystack hosted payment link
      history.replaceState(null, "", "/payments");
      apiCall("/paystack/verify", { reference: ref }).then(() => showToast("Payment verified and logged", "success")).catch((e) => showToast("Could not verify payment: " + e.message, "error"));
    }
    const id = sp.get("lease");
    if (id && M.leaseById[id]) openCollect(id);
  }

  function render() {
    $("sum-collected").textContent = formatKsh(M.collectedMonth);
    $("sum-expected").textContent = formatKsh(M.expected);
    $("sum-arrears").textContent = formatKsh(M.arrears);
    $("sum-arrears").className = "text-2xl font-bold mt-1 num " + (M.arrears ? "txt-late" : "");
    $("sum-month").textContent = new Date().toLocaleString("en-KE", { month: "long", year: "numeric" });
    const pct = M.expected ? Math.min(100, Math.round((M.collectedMonth / M.expected) * 100)) : 0;
    $("sum-rate").style.width = pct + "%"; $("sum-rate-txt").textContent = pct + "% of expected rent collected";

    const inView = (p) => (view === "archive" ? p.archived : !p.archived);
    const nRecent = M.payments.filter((p) => !p.archived).length, nArch = M.payments.length - nRecent;
    $("views").innerHTML = [["recent", `Last 30 days`, nRecent], ["archive", "Archive", nArch]].map(([k, n, c]) => `<button class="tab ${view === k ? "on" : ""}" data-v="${k}">${n}<span class="cnt">${c}</span></button>`).join("");
    $("tabs").innerHTML = [["all", "All"], ["RENT", "Rent"], ["DEPOSIT", "Deposits"]].map(([k, n]) => `<button class="tab ${filter === k ? "on" : ""}" data-f="${k}">${n}</button>`).join("");
    const list = M.payments.filter((p) => inView(p) && (filter === "all" || (p.type || "RENT") === filter) && (!q || `${p.tenantName} ${p.mpesa_receipt || ""} ${p.provider_ref || ""} ${p.houseLabel || ""}`.toLowerCase().includes(q)));
    visible = list;
    $("view-note").textContent = view === "archive" ? "Payments older than 30 days, grouped by month. They still count toward each tenant's balance and statement." : "Payments from the last 30 days. Older ones move to the Archive automatically.";
    const el = $("payments-list");
    if (!list.length) {
      const none = !M.payments.length;
      el.innerHTML = PF.emptyState("payments", none ? "No payments yet" : view === "archive" ? "Nothing archived yet" : "No payments in the last 30 days", none ? "Collect rent with Paystack, log a cash payment, or paste an M-Pesa SMS to confirm it instantly." : view === "archive" ? "Payments move here 30 days after they are received." : (nArch ? "Older payments are in the Archive." : "Try another filter."), none ? '<button class="btn btn-brand" onclick="openCollect()">Collect rent</button>' : "");
      return;
    }
    const table = (rows) => `<div class="scroll-x"><table class="tbl"><thead><tr><th>Date</th><th>Tenant</th><th class="hidden md:table-cell">Room</th><th class="hidden sm:table-cell">Method</th><th class="hidden lg:table-cell">Reference</th><th class="r">Amount</th><th></th></tr></thead><tbody>` +
      rows.map((p) => {
        const dep = p.type === "DEPOSIT", prov = (p.provider || p.method || "manual").toUpperCase();
        const badge = prov === "PAYSTACK" ? `<span class="pill pill-paid">PAYSTACK${p.verified === false ? " · unverified" : ""}</span>` : p.mpesa_receipt ? '<span class="pill pill-paid">M-PESA</span>' : '<span class="pill pill-neutral">MANUAL</span>';
        return `<tr><td class="whitespace-nowrap num">${B.fmtDate(M.dateOf(p))}</td><td><div class="font-medium">${esc(p.tenantName || "Tenant")}</div><div class="text-xs text-gray-500">${dep ? "Security deposit" : esc(p.billing_cycle ? "Rent · " + p.billing_cycle : p.note || "Rent")}</div></td>
          <td class="hidden md:table-cell text-gray-600">${esc(p.houseLabel || "—")}</td><td class="hidden sm:table-cell">${badge}</td><td class="hidden lg:table-cell text-xs text-gray-500 num">${esc(p.mpesa_receipt || p.provider_ref || "—")}</td>
          <td class="r font-semibold num ${dep ? "text-gray-500" : ""}">${formatKsh(p.amount)}</td><td class="r"><button class="btn btn-sm" data-rc="${p.id}">Receipt</button></td></tr>`;
      }).join("") + "</tbody></table></div>";
    if (view === "recent") { el.innerHTML = table(list.slice(0, 200)); return; }
    const groups = {}; list.forEach((p) => { const d = M.dateOf(p), k = d.getFullYear() * 100 + d.getMonth(); (groups[k] = groups[k] || { d, rows: [] }).rows.push(p); });
    el.innerHTML = Object.keys(groups).sort((a, b) => b - a).map((k, i) => { const g = groups[k], rent = g.rows.filter((p) => (p.type || "RENT") === "RENT").reduce((s, p) => s + (p.amount || 0), 0);
      return `<details class="group" ${i === 0 ? "open" : ""}><summary class="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer bg-gray-50/60 border-b border-[var(--line)] select-none"><span class="font-semibold">${g.d.toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</span><span class="text-sm text-gray-500"><span class="num">${g.rows.length}</span> payments · rent <span class="num font-medium text-gray-800">${formatKsh(rent)}</span></span></summary>${table(g.rows)}</details>`; }).join("");
  }
  $("payments-list").addEventListener("click", (e) => { const b = e.target.closest("[data-rc]"); if (b) { const p = M.payments.find((x) => x.id === b.dataset.rc); if (p) Receipts.show({ ...p, paidAtDate: M.dateOf(p) }, M.leaseById[p.leaseId]); } });
  $("views").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { view = b.dataset.v; render(); } });
  $("pdf-pay").addEventListener("click", async () => {
    if (!visible.length) return showToast("No payments to export in this view", "info");
    const b = $("pdf-pay"), t = b.textContent; b.disabled = true; b.textContent = "Preparing…";
    try { await PDFLedger.downloadPayments(visible, { landlord: PF.profile && PF.profile.fullName, business: (PF.profile && PF.profile.businessName) || "PropFlow KE", label: view === "archive" ? "Archived payments (older than 30 days)" : "Payments — last 30 days" }); }
    catch (e) { showToast(e.message, "error"); } finally { b.disabled = false; b.textContent = t; }
  });
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } });
  $("search").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });

  /* ---------------- collect modal ---------------- */
  function fillLeases() {
    const s = $("c-lease"); if (!s) return; const keep = s.value;
    s.innerHTML = '<option value="">Select tenant…</option>' + M.active.map((l) => `<option value="${l.id}">${esc(l.tenantName)} — ${esc(l.houseLabel)} · ${esc(l.roomLabels)}</option>`).join("");
    if (keep) s.value = keep;
  }
  window.openCollect = function (leaseId) {
    $("collect-form").reset(); $("c-date").value = B.toISO(new Date());
    if (!M || !M.active.length) return showToast("Add a tenant to a room first, then you can collect rent.", "info");
    fillLeases(); if (leaseId) $("c-lease").value = leaseId;
    onLease(); PF.openModal("collect-modal");
  };
  window.closeCollect = () => PF.closeModal("collect-modal");
  const cur = () => M.leaseById[$("c-lease").value];
  function onLease() {
    const l = cur(), info = $("c-info"), amt = $("c-amount"), go = $("c-go");
    if (!l) { info.innerHTML = ""; amt.value = ""; go.disabled = true; return; }
    const ev = l.ev;
    if (ev.locked) {
      info.innerHTML = `<div class="flex items-center gap-2 txt-paid font-medium">🔒 ${B.cycleLabel(ev.nextDue)} is paid — cycle locked</div><div class="text-xs text-gray-500 mt-1">Next payment opens after ${B.fmtDate(ev.nextDue)}.</div>`;
      amt.value = ""; amt.disabled = true; go.disabled = true; return;
    }
    amt.disabled = false; go.disabled = false;
    const suggested = ev.owed > 0 ? ev.owed : ev.nextBalance;
    amt.value = suggested; amt.max = ev.maxPayable;
    info.innerHTML = `<div class="flex justify-between"><span class="text-gray-500">Status</span><span class="font-semibold txt-${ev.tone}">${esc(ev.label)}</span></div>
      <div class="flex justify-between"><span class="text-gray-500">Applies to</span><span class="font-medium">${B.cycleLabel(ev.targetDue)}</span></div>
      <div class="flex justify-between"><span class="text-gray-500">Max collectable</span><span class="font-medium num">${formatKsh(ev.maxPayable)}</span></div>`;
  }
  $("c-lease").onchange = onLease;
  document.querySelectorAll('input[name="method"]').forEach((r) => (r.onchange = () => { const m = document.querySelector('input[name="method"]:checked').value; $("c-manual").classList.toggle("hidden", m === "paystack"); }));

  $("collect-form").onsubmit = async (e) => {
    e.preventDefault();
    const l = cur(), amount = parseFloat($("c-amount").value), method = document.querySelector('input[name="method"]:checked').value;
    if (!l) return showToast("Select a tenant", "error");
    if (!(amount > 0)) return showToast("Enter an amount", "error");
    const c = PaymentProcessor.check(l, amount); if (!c.ok) return showToast(c.reason, "error");
    const go = $("c-go"); go.disabled = true; const label = go.textContent;
    try {
      if (method === "paystack") {
        go.textContent = "Opening Paystack…";
        const r = await PaymentProcessor.payWithPaystack(l, amount);
        PF.closeModal("collect-modal");
        showToast(r.verified ? "Payment verified — cycle locked as PAID" : "Payment received (verification pending deploy of Cloud Functions)", "success");
        if (r.payment) Receipts.show(r.payment, l);
      } else {
        const code = $("c-ref").value.trim().toUpperCase();
        const p = PaymentProcessor.record(l, { amount, provider: "MANUAL", mpesa_receipt: code || null, paidAt: $("c-date").value, note: $("c-note").value.trim() || (code ? "M-Pesa " + code : "Cash payment") });
        PF.closeModal("collect-modal");
        const rec = await PF.fire(p, null);
        Receipts.show(rec, l);
      }
    } catch (err) { if (!err.cancelled) showToast(err.message, "error"); }
    finally { go.disabled = false; go.textContent = label; }
  };
})();
