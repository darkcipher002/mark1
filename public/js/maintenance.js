/* PropFlow KE — Maintenance tickets linked to properties / houses / rooms */
(function () {
  const $ = (id) => document.getElementById(id);
  const B = PFBilling;
  let M = null, tab = "all";
  const STAT = { open: ["Open", "pill-late"], in_progress: ["In progress", "pill-due"], resolved: ["Resolved", "pill-paid"] };
  const norm = (s) => (s === "closed" ? "resolved" : STAT[s] ? s : "open"); // legacy "closed" -> resolved
  const PRI = { high: "txt-late", medium: "txt-due", low: "text-gray-500" };

  PF.boot(() => PF.watch(["maintenance", "properties", "houses", "rooms"], (m) => { M = m; render(); fillWhere(); }));

  function fillWhere() {
    const s = $("tk-where"), keep = s.value; let h = '<option value="">Common area / whole property</option>';
    M.properties.forEach((p) => {
      h += `<optgroup label="${esc(p.name)}">` + `<option value="p:${p.id}">${esc(p.name)} — general</option>`;
      M.houses.filter((x) => x.propertyId === p.id).forEach((x) => {
        h += `<option value="h:${x.id}">${esc(x.label)} — whole house</option>`;
        (M.roomsByHouse[x.id] || []).forEach((r) => (h += `<option value="r:${r.id}">${esc(x.label)} · ${esc(r.label)} (${esc(r.tier)})</option>`));
      });
      h += "</optgroup>";
    });
    s.innerHTML = h; if (keep) s.value = keep;
  }
  const where = (t) => {
    if (t.roomId && M.roomById[t.roomId]) { const r = M.roomById[t.roomId], h = M.houseById[r.houseId]; return `${h ? h.label : ""} · ${r.label} (${r.tier})`; }
    if (t.houseId && M.houseById[t.houseId]) return M.houseById[t.houseId].label;
    if (t.propertyId && M.propById[t.propertyId]) return M.propById[t.propertyId].name;
    return t.locationLabel || "Common area";
  };

  function render() {
    const all = M.maintenance.map((t) => ({ ...t, st: norm(t.status) }));
    const vis = (t, k) => (k === "archive" ? t.archived : !t.archived && (k === "all" || t.st === k));
    const cnt = (k) => all.filter((t) => vis(t, k)).length;
    $("tabs").innerHTML = [["all", "All"], ["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"], ["archive", "Archive"]].map(([k, n]) => `<button class="tab ${tab === k ? "on" : ""}" data-t="${k}">${n}<span class="cnt">${cnt(k)}</span></button>`).join("");
    const list = all.filter((t) => vis(t, tab));
    const el = $("tickets-list");
    if (!list.length) { el.innerHTML = PF.emptyState("maintenance", all.length ? (tab === "archive" ? "Archive is empty" : "Nothing in this view") : "No maintenance requests", all.length ? (tab === "archive" ? "Requests resolved more than 30 days ago move here automatically." : "Try another filter.") : "Log repairs against a specific house or room and track them to resolution.", all.length ? "" : '<button class="btn btn-brand" onclick="openTicket()">Log first request</button>'); return; }
    el.innerHTML = list.map((t) => {
      const d = t.createdAt && t.createdAt.toDate ? B.fmtDate(t.createdAt.toDate()) : "Just now";
      const [lbl, cls] = STAT[t.st];
      return `<div class="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div class="min-w-0"><div class="flex items-center gap-2 flex-wrap"><p class="font-semibold">${esc(t.title)}</p><span class="pill ${cls}">${lbl}</span></div>
          ${t.description ? `<p class="text-sm text-gray-600 mt-1">${esc(t.description)}</p>` : ""}
          <p class="text-xs text-gray-500 mt-1.5">${esc(where(t))} · <span class="${PRI[t.priority] || ""} font-medium capitalize">${esc(t.priority || "medium")} priority</span> · ${d}</p></div>
        <div class="flex gap-2 shrink-0 flex-wrap">
          ${t.st === "open" ? `<button class="btn btn-sm" data-s="in_progress" data-id="${t.id}">Start work</button>` : ""}
          ${t.st !== "resolved" ? `<button class="btn btn-sm btn-brand" data-s="resolved" data-id="${t.id}">Mark resolved</button>` : `<button class="btn btn-sm" data-s="open" data-id="${t.id}">Reopen</button>`}
          <button class="btn btn-sm btn-danger" data-del="${t.id}" aria-label="Delete request">Delete</button></div></div>`;
    }).join("");
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { tab = b.dataset.t; render(); } });
  $("tickets-list").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.s) PF.fire(db.collection("maintenance").doc(b.dataset.id).update({ status: b.dataset.s, updatedAt: PF.ts(), resolvedAt: b.dataset.s === "resolved" ? PF.ts() : null }), null, "Update failed");
    if (b.dataset.del && await PF.confirm({ title: "Delete request?", message: "This can't be undone.", confirmText: "Delete", danger: true })) PF.fire(db.collection("maintenance").doc(b.dataset.del).delete(), "Request deleted", "Delete failed");
  });

  window.openTicket = () => { $("ticket-form").reset(); PF.openModal("ticket-modal"); };
  $("ticket-form").onsubmit = (e) => {
    e.preventDefault();
    const title = $("tk-title").value.trim(); if (!title) return showToast("Give the request a title", "error");
    const w = $("tk-where").value, doc = { ownerId: auth.currentUser.uid, title, description: $("tk-desc").value.trim(), priority: $("tk-priority").value, status: "open", propertyId: null, houseId: null, roomId: null, createdAt: PF.ts(), updatedAt: PF.ts() };
    if (w.startsWith("p:")) doc.propertyId = w.slice(2);
    if (w.startsWith("h:")) { doc.houseId = w.slice(2); const h = M.houseById[doc.houseId]; doc.propertyId = h && h.propertyId; }
    if (w.startsWith("r:")) { doc.roomId = w.slice(2); const r = M.roomById[doc.roomId]; doc.houseId = r && r.houseId; doc.propertyId = r && r.propertyId; }
    PF.closeModal("ticket-modal");
    PF.fire(db.collection("maintenance").add(doc), "Request logged", "Could not log request");
  };
})();
