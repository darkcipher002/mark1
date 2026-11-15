/* PropFlow KE — Today command center: live collection, action queue, portfolio intelligence brief */
(function () {
  const B = PFBilling;
  const $ = (id) => document.getElementById(id);
  let M = null;

  PF.boot((user) => {
    $("greeting-text").textContent = getGreeting();
    document.querySelectorAll("[data-first-name]").forEach((el) => (el.textContent = getFirstName(PF.profile, user)));
    $("today-date").textContent = new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" });
    PF.onProfile(renderTrial);
    PF.watch(["properties", "houses", "rooms", "leases", "payments", "maintenance"], (m) => { M = m; render(); });
  });

  function renderTrial(p) {
    const el = $("trial-text"); if (!el || !p) return;
    if (!p.trialEndsAt) { el.textContent = "Your trial is active."; return; }
    const d = Math.ceil((new Date(p.trialEndsAt) - new Date()) / 86400000);
    el.textContent = d <= 0 ? "Trial ended." : d === 1 ? "1 day left in your trial." : `${d} days left in your trial.`;
  }

  function insights() {
    const out = [], act = M.active;
    const late = act.filter((l) => l.ev.status === "OVERDUE"), soon = act.filter((l) => l.ev.status === "DUE_SOON");
    if (!M.properties.length) return [["info", "Add your first property to unlock live collection tracking and insights."]];
    if (late.length) { const w = late.slice().sort((a, b) => b.ev.daysLate - a.ev.daysLate)[0]; out.push(["late", `<b>${late.length} tenant${late.length > 1 ? "s are" : " is"} overdue</b> owing <b class="num">${formatKsh(M.arrears)}</b>. Longest: ${esc(w.tenantName)} (${w.ev.daysLate} days).`]); }
    if (soon.length) out.push(["due", `<b>${soon.length} rent${soon.length > 1 ? "s" : ""} due within 3 days</b> — <span class="num">${formatKsh(soon.reduce((s, l) => s + l.ev.owed, 0))}</span>. Send reminders now to get paid on time.`]);
    if (!late.length && !soon.length && act.length) out.push(["paid", "Every tenant is paid up. Nothing needs chasing today."]);
    if (M.expected) { const left = Math.max(0, M.expected - M.collectedMonth); out.push(["info", left ? `<span class="num">${formatKsh(left)}</span> of this month's projected <span class="num">${formatKsh(M.expected)}</span> is still to be collected.` : "You've collected all of this month's projected rent."]); }
    if (M.vacantRooms.length) { const top = M.vacantRooms.slice().sort((a, b) => b.rent - a.rent)[0], h = M.houseById[top.houseId]; out.push(["due", `<b>${M.vacantRooms.length} vacant room${M.vacantRooms.length > 1 ? "s" : ""}</b> cost you <b class="num">${formatKsh(M.vacantRevenue)}</b>/month. Highest value: ${esc(h ? h.label : "")} · ${esc(top.label)} (${esc(top.tier)}) at <span class="num">${formatKsh(top.rent)}</span>.`]); }
    const open = M.maintenance.filter((t) => !["resolved", "closed"].includes(t.status)), hi = open.filter((t) => t.priority === "high");
    if (hi.length) out.push(["late", `<b>${hi.length} high-priority maintenance request${hi.length > 1 ? "s" : ""}</b> still open.`]);
    return out;
  }

  function render() {
    const act = M.active, pct = M.expected ? Math.min(100, Math.round((M.collectedMonth / M.expected) * 100)) : 0;
    const lateN = act.filter((l) => l.ev.status === "OVERDUE").length;
    $("k-rate").textContent = M.expected ? pct + "%" : "—";
    $("k-rate-bar").style.width = pct + "%";
    $("k-rate-sub").textContent = M.expected ? `${act.length} active tenanc${act.length === 1 ? "y" : "ies"}` : "No active tenancies yet";
    $("k-collected").textContent = formatKsh(M.collectedMonth);
    $("k-projected").textContent = "of " + formatKsh(M.expected) + " projected";
    $("k-arrears").textContent = formatKsh(M.arrears);
    $("k-arrears").className = "text-2xl font-bold mt-1 num " + (M.arrears ? "txt-late" : "");
    $("k-arrears-sub").textContent = lateN ? `${lateN} tenant${lateN > 1 ? "s" : ""} late` : "No one is late";
    $("k-vacant").textContent = formatKsh(M.vacantRevenue);
    $("k-vacant-sub").textContent = `${M.vacantRooms.length} vacant room${M.vacantRooms.length === 1 ? "" : "s"} · per month`;
    const occ = M.rooms.length - M.vacantRooms.length;
    $("k-occ").textContent = M.rooms.length ? Math.round((occ / M.rooms.length) * 100) + "% occupied" : "";

    // Action queue
    const q = M.attention;
    $("q-count").textContent = q.length ? q.length : "";
    $("queue").innerHTML = q.length ? q.map((l) => `<div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0"><span class="w-1.5 self-stretch rounded-full ${l.ev.status === "OVERDUE" ? "bg-[var(--late)]" : "bg-[#f59e0b]"}"></span>
          <div class="min-w-0"><p class="font-semibold truncate">${esc(l.tenantName)} <span class="text-xs font-normal text-gray-500">${esc(l.houseLabel)} · ${esc(l.roomLabels)}</span></p>
          <p class="text-sm txt-${l.ev.tone} font-medium num">${esc(l.ev.label)}</p></div></div>
        <div class="flex gap-2 shrink-0"><button class="btn btn-sm btn-soft" data-act="remind" data-id="${l.id}">Remind</button><button class="btn btn-sm btn-brand" data-act="collect" data-id="${l.id}">Collect</button></div></div>`).join("")
      : (act.length ? PF.emptyState("payments", "All caught up", "Nobody is late or due in the next 3 days.") : PF.emptyState("tenants", "No tenants yet", "Assign a tenant to a vacant room and rent tracking starts automatically.", '<button class="btn btn-brand" onclick="Tenancy.openAssign()">Add a tenant</button>'));

    // Brief
    const ico = { late: "bg-[var(--late)]", due: "bg-[#f59e0b]", paid: "bg-[var(--paid)]", info: "bg-gray-300" };
    $("brief").innerHTML = insights().map(([t, h]) => `<li class="flex gap-3 text-sm leading-relaxed"><span class="mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${ico[t]}"></span><span>${h}</span></li>`).join("");

    // Recent payments
    const rp = M.payments.filter((p) => !p.archived).slice(0, 5), nArch = M.payments.filter((p) => p.archived).length;
    $("recent").innerHTML = rp.length ? rp.map((p) => `<div class="py-2.5 flex justify-between gap-3 text-sm"><div class="min-w-0"><p class="font-medium truncate">${esc(p.tenantName || "Tenant")}</p><p class="text-xs text-gray-500">${B.fmtDate(M.dateOf(p))} · ${p.type === "DEPOSIT" ? "Deposit" : "Rent"}</p></div><span class="font-semibold num">${formatKsh(p.amount)}</span></div>`).join("") : `<p class="text-sm text-gray-500 py-4">${M.payments.length ? "No payments in the last 30 days." : "No payments yet."}</p>`;
    $("recent-arch").innerHTML = nArch ? `<a href="/payments" class="text-xs text-gray-500 hover:text-brand-600">${nArch} older payment${nArch > 1 ? "s" : ""} in Archive →</a>` : "";

    $("setup-card").classList.toggle("hidden", M.properties.length > 0);
    const open = M.maintenance.filter((t) => !["resolved", "closed"].includes(t.status)).length;
    $("k-maint").textContent = open;
  }

  $("queue").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "remind") AI.openReminder(b.dataset.id); else location.href = "/payments?lease=" + b.dataset.id;
  });
})();
