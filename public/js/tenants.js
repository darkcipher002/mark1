/* PropFlow KE — Tenants: live billing status, reminders, statements, vacate */
(function () {
  const B = PFBilling;
  const $ = (id) => document.getElementById(id);
  let M = null, tab = "active", q = "";

  PF.boot(() => {
    PF.watch(["properties", "houses", "rooms", "leases", "payments", "tenants"], (m) => { M = m; render(); });
    if (new URLSearchParams(location.search).get("new")) setTimeout(() => Tenancy.openAssign(), 300);
  });

  const TABS = [["active", "All active"], ["OVERDUE", "Overdue"], ["DUE_SOON", "Due soon"], ["PAID", "Paid"], ["former", "Former"], ["archive", "Archive"]];
  const inTab = (l, t) => (t === "former" ? l.status === "ENDED" && !l.archived : t === "archive" ? l.status === "ENDED" && l.archived : l.status === "ACTIVE" && (t === "active" || l.ev.status === t));
  const sel = (l) => inTab(l, tab);
  const match = (l) => !q || `${l.tenantName} ${l.phone} ${l.houseLabel} ${l.roomLabels} ${l.propertyName}`.toLowerCase().includes(q);

  function count(t) { return M.leases.filter((l) => inTab(l, t)).length; }

  function row(l) {
    const ended = l.status === "ENDED", ev = l.ev;
    const sub = `${esc(l.propertyName)} · ${esc(l.houseLabel)} · ${l.mode === "WHOLE_HOUSE" ? "Whole house" : esc(l.roomLabels)}`;
    const status = ended
      ? `<span class="pill pill-neutral">MOVED OUT ${l.move_out_date ? B.fmtDate(B.parseISO(l.move_out_date)).toUpperCase() : ""}</span>`
      : `<div>${PF.pill(ev)}<div class="text-xs mt-1 txt-${ev.tone} font-medium num">${esc(ev.label)}</div></div>`;
    const actions = ended
      ? `<button class="btn btn-sm" data-act="pdf" data-id="${l.id}">Statement PDF</button>`
      : `${ev.status !== "PAID" ? `<button class="btn btn-sm btn-soft" data-act="remind" data-id="${l.id}">Remind</button>` : ""}
         <button class="btn btn-sm btn-brand" data-act="collect" data-id="${l.id}" ${ev.locked ? "disabled title='This cycle is paid and locked'" : ""}>Collect</button>
         <button class="btn btn-sm" data-act="access" data-id="${l.id}">Access &amp; QR</button>
         <button class="btn btn-sm" data-act="pdf" data-id="${l.id}">Statement</button>
         <button class="btn btn-sm btn-danger" data-act="vacate" data-id="${l.id}">Vacate</button>`;
    return `<div class="p-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
      <div class="flex items-center gap-3 lg:w-[30%] min-w-0">
        <div class="w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold text-sm shrink-0">${esc(getInitials(l.tenantName))}</div>
        <div class="min-w-0"><p class="font-semibold truncate">${esc(l.tenantName)}</p><p class="text-xs text-gray-500 truncate num">${esc(l.phone || "")}</p></div>
      </div>
      <div class="lg:flex-1 min-w-0"><p class="text-sm truncate">${sub}</p><p class="text-xs text-gray-500 num">${formatKsh(l.rent)}/mo · due every ${B.ordinal(l.billingDay || B.parseISO(l.move_in_date).getDate())} · since ${B.fmtDate(B.parseISO(l.move_in_date))}</p></div>
      <div class="lg:w-52">${status}</div>
      <div class="flex flex-wrap gap-2 lg:justify-end">${actions}</div></div>`;
  }

  function render() {
    $("tabs").innerHTML = TABS.map(([k, n]) => `<button class="tab ${tab === k ? "on" : ""}" data-tab="${k}">${n}<span class="cnt">${count(k)}</span></button>`).join("");
    const list = M.leases.filter((l) => sel(l) && match(l));
    const order = { OVERDUE: 0, DUE_SOON: 1, PAID: 2 };
    if (!["former", "archive"].includes(tab)) list.sort((a, b) => order[a.ev.status] - order[b.ev.status] || (b.ev.daysLate - a.ev.daysLate));
    const el = $("tenants-list");
    if (!list.length) {
      const none = !M.leases.length;
      el.innerHTML = PF.emptyState("tenants", none ? "No tenants yet" : q ? "No matches" : "Nothing here", none ? "Assign a tenant to a vacant room — PropFlow tracks the deposit, the monthly due date and late payments for you." : q ? "Try a different search." : "No tenants in this view.", none ? '<button class="btn btn-brand" onclick="Tenancy.openAssign()">Add your first tenant</button>' : "");
      return;
    }
    el.innerHTML = list.map(row).join("");
  }

  $("pdf-list").addEventListener("click", async () => {
    const list = M.leases.filter((l) => sel(l) && match(l)); if (!list.length) return showToast("No tenants to export in this view", "info");
    const b = $("pdf-list"), t = b.textContent; b.disabled = true; b.textContent = "Preparing…";
    try { await PDFLedger.downloadTenants(list, { landlord: PF.profile && PF.profile.fullName, business: (PF.profile && PF.profile.businessName) || "PropFlow KE", label: (TABS.find((x) => x[0] === tab) || [])[1] + " tenants" + (q ? ` matching "${q}"` : "") }); }
    catch (e) { showToast(e.message, "error"); } finally { b.disabled = false; b.textContent = t; }
  });
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });
  $("search").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $("tenants-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
    const l = M.leaseById[b.dataset.id]; const a = b.dataset.act;
    if (a === "collect") location.href = "/payments?lease=" + l.id;
    if (a === "remind") AI.openReminder(l.id);
    if (a === "access") PF.openAccess(l).catch((err) => showToast(err.message, "error"));
    if (a === "vacate") Tenancy.openVacate(l.id);
    if (a === "pdf") {
      b.disabled = true; const t = b.textContent; b.textContent = "Preparing…";
      try { await PDFLedger.download(l, { landlord: PF.profile && PF.profile.fullName, business: (PF.profile && PF.profile.businessName) || "PropFlow KE" }); }
      catch (err) { showToast(err.message, "error"); }
      finally { b.disabled = false; b.textContent = t; }
    }
  });
})();
