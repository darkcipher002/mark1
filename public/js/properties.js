/* PropFlow KE — Properties: property cards, houses & rooms (3BR tiered, 2BR fixed), per-room independence */
(function () {
  const B = PFBilling;
  const $ = (id) => document.getElementById(id);
  let M = null, openProp = null, editRoomId = null;

  PF.boot(() => {
    PF.watch(["properties", "houses", "rooms", "leases", "payments"], (m) => { M = m; render(); if (openProp) renderHouses(); });
    if (new URLSearchParams(location.search).get("new")) setTimeout(openAdd, 300);
  });

  /* ------------------------------------------------------------ property cards */
  function statsFor(pid) {
    const hs = M.houses.filter((h) => h.propertyId === pid), rs = M.rooms.filter((r) => r.propertyId === pid);
    const occ = rs.filter((r) => r.status === "OCCUPIED");
    return { houses: hs.length, rooms: rs.length, occ: occ.length, vac: rs.length - occ.length,
      potential: rs.reduce((s, r) => s + (r.rent || 0), 0), earning: occ.reduce((s, r) => s + (r.rent || 0), 0),
      vacantRent: rs.filter((r) => r.status !== "OCCUPIED").reduce((s, r) => s + (r.rent || 0), 0) };
  }

  function render() {
    const grid = $("properties-grid"), empty = $("empty-state");
    $("stat-props").textContent = M.properties.length;
    $("stat-houses").textContent = M.houses.length;
    const occ = M.rooms.filter((r) => r.status === "OCCUPIED").length;
    $("stat-occ").textContent = occ; $("stat-vac").textContent = M.rooms.length - occ;
    $("stat-open").textContent = formatKsh(M.vacantRevenue);
    if (!M.properties.length) { grid.innerHTML = ""; empty.classList.remove("hidden"); empty.innerHTML = PF.emptyState("properties", "No properties yet", "Add your first property, then choose how many 3-bedroom and 2-bedroom houses it has. PropFlow creates every room with its rent automatically.", '<button class="btn btn-brand" onclick="openAdd()">Add your first property</button>'); return; }
    empty.classList.add("hidden");
    grid.innerHTML = M.properties.map((p) => {
      const s = statsFor(p.id), pct = s.rooms ? Math.round((s.occ / s.rooms) * 100) : 0;
      return `<article class="card card-hover overflow-hidden">
        <div class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0"><h3 class="font-semibold text-lg truncate">${esc(p.name)}</h3><p class="text-sm text-gray-500 truncate">${esc(p.location || "No location set")}</p></div>
            <span class="pill pill-neutral">${s.houses} house${s.houses === 1 ? "" : "s"}</span>
          </div>
          <div class="mt-4"><div class="flex justify-between text-xs text-gray-500 mb-1.5"><span>${s.occ} of ${s.rooms} rooms occupied</span><span class="num font-medium">${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>
          <div class="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div class="rounded-xl bg-gray-50 p-3"><div class="text-[11px] text-gray-500">Earning / month</div><div class="font-semibold num">${formatKsh(s.earning)}</div></div>
            <div class="rounded-xl ${s.vac ? "bg-amber-50" : "bg-gray-50"} p-3"><div class="text-[11px] text-gray-500">Vacant (${s.vac}) could earn</div><div class="font-semibold num ${s.vac ? "txt-due" : ""}">${formatKsh(s.vacantRent)}</div></div>
          </div>
          <div class="flex gap-2 mt-4">
            <button class="btn btn-soft flex-1" data-act="houses" data-id="${p.id}">Houses &amp; rooms</button>
            <button class="btn" data-act="edit" data-id="${p.id}" aria-label="Edit property">Edit</button>
            <button class="btn btn-danger" data-act="del" data-id="${p.id}" aria-label="Delete property">Delete</button>
          </div>
        </div></article>`;
    }).join("");
  }

  $("properties-grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    ({ houses: openHouses, edit: editProp, del: delProp })[b.dataset.act](b.dataset.id);
  });

  /* ------------------------------------------------------------ add / edit property */
  function mixPreview() {
    const n3 = +$("p-n3").value || 0, n2 = +$("p-n2").value || 0, ns = +$("p-ns").value || 0, sr = +$("p-srent").value || 0;
    const rooms = n3 * 3 + n2 * 2 + ns, pot = n3 * 25500 + n2 * 18000 + ns * sr;
    $("p-preview").innerHTML = rooms ? `<b>${n3 + n2 + ns}</b> houses · <b>${rooms}</b> rooms · potential <b class="num">${formatKsh(pot)}</b>/month` : "Add at least one house below.";
  }
  window.openAdd = function () {
    $("prop-id").value = ""; $("prop-form").reset(); $("modal-title").textContent = "Add property"; $("mix").classList.remove("hidden"); $("save-btn").textContent = "Create property";
    mixPreview(); PF.openModal("prop-modal");
  };
  function editProp(id) {
    const p = M.propById[id]; if (!p) return;
    $("prop-id").value = id; $("prop-name").value = p.name || ""; $("prop-location").value = p.location || "";
    $("modal-title").textContent = "Edit property"; $("mix").classList.add("hidden"); $("save-btn").textContent = "Save changes"; PF.openModal("prop-modal");
  }
  window.closeModal = () => PF.closeModal("prop-modal");
  ["p-n3", "p-n2", "p-ns", "p-srent"].forEach((i) => $(i).addEventListener("input", mixPreview));

  function houseOps(propId, uid, category, count, startAt, singleRent) {
    const ops = []; const cat = B.CATEGORIES[category];
    for (let i = 0; i < count; i++) {
      const hRef = db.collection("houses").doc(), n = startAt + i;
      const rooms = category === "SINGLE" ? [{ label: "Unit", tier: "Standard", rent: singleRent }] : cat.rooms;
      ops.push([hRef, { ownerId: uid, propertyId: propId, label: (category === "SINGLE" ? "Unit " : "House ") + n, category, roomCount: rooms.length, wholeHouseRent: rooms.reduce((s, r) => s + r.rent, 0), createdAt: PF.ts() }]);
      rooms.forEach((r, k) => ops.push([db.collection("rooms").doc(), { ownerId: uid, propertyId: propId, houseId: hRef.id, label: r.label, tier: r.tier, rent: r.rent, order: n * 10 + k, status: "VACANT", leaseId: null, tenantId: null, tenantName: null, createdAt: PF.ts() }]));
    }
    return ops;
  }
  function commitOps(ops) {
    const ps = [];
    for (let i = 0; i < ops.length; i += 450) { const b = db.batch(); ops.slice(i, i + 450).forEach(([r, d]) => b.set(r, d)); ps.push(b.commit()); }
    return Promise.all(ps);
  }

  window.saveProp = function (e) {
    e.preventDefault();
    const id = $("prop-id").value, name = $("prop-name").value.trim(), location = $("prop-location").value.trim();
    if (!name) return showToast("Property name is required", "error");
    const uid = auth.currentUser.uid;
    if (id) { PF.closeModal("prop-modal"); return PF.fire(db.collection("properties").doc(id).update({ name, location, updatedAt: PF.ts() }), "Property updated"); }
    const n3 = +$("p-n3").value || 0, n2 = +$("p-n2").value || 0, ns = +$("p-ns").value || 0, sr = +$("p-srent").value || 0;
    if (n3 + n2 + ns < 1) return showToast("Add at least one house", "error");
    if (n3 + n2 + ns > 60) return showToast("Up to 60 houses per property at a time", "error");
    if (ns && sr <= 0) return showToast("Enter the rent for single units", "error");
    const pRef = db.collection("properties").doc();
    const ops = [[pRef, { ownerId: uid, name, location, createdAt: PF.ts(), updatedAt: PF.ts() }],
      ...houseOps(pRef.id, uid, "3BR_TIERED", n3, 1, 0), ...houseOps(pRef.id, uid, "2BR_FIXED", n2, n3 + 1, 0), ...houseOps(pRef.id, uid, "SINGLE", ns, 1, sr)];
    PF.closeModal("prop-modal");
    PF.fire(commitOps(ops), `${name} created with ${n3 + n2 + ns} houses`, "Could not create property");
  };

  async function delProp(id) {
    const rs = M.rooms.filter((r) => r.propertyId === id);
    if (rs.some((r) => r.status === "OCCUPIED")) return showToast("This property has active tenants. Vacate them first.", "error");
    if (!(await PF.confirm({ title: "Delete property?", message: `This removes ${M.propById[id].name} and its ${M.houses.filter((h) => h.propertyId === id).length} houses. Payment history is kept.`, confirmText: "Delete", danger: true }))) return;
    const b = db.batch();
    rs.forEach((r) => b.delete(db.collection("rooms").doc(r.id)));
    M.houses.filter((h) => h.propertyId === id).forEach((h) => b.delete(db.collection("houses").doc(h.id)));
    b.delete(db.collection("properties").doc(id));
    PF.fire(b.commit(), "Property deleted", "Delete failed");
  }

  /* ------------------------------------------------------------ houses & rooms modal */
  function openHouses(pid) { openProp = pid; $("houses-title").textContent = M.propById[pid].name; renderHouses(); PF.openModal("houses-modal"); }
  window.closeHouses = () => { openProp = null; PF.closeModal("houses-modal"); };

  function roomRow(r) {
    const l = r.leaseId && M.leaseById[r.leaseId];
    const tier = `<span class="pill pill-neutral">${esc(r.tier)}</span>`;
    const left = `<div class="flex items-center gap-2 min-w-0">${tier}<div class="min-w-0"><div class="text-sm font-medium truncate">${esc(r.label)}</div>
      <div class="text-xs text-gray-500 num">${formatKsh(r.rent)}/mo <button class="text-brand-600 font-medium ml-1" data-act="rent" data-id="${r.id}">edit</button></div></div></div>`;
    if (r.status === "OCCUPIED" && l) {
      return `<div class="flex items-center justify-between gap-3 py-2.5">${left}<div class="flex items-center gap-2 shrink-0"><div class="text-right hidden sm:block"><div class="text-sm font-medium">${esc(l.tenantName)}</div><div class="text-xs ${"txt-" + l.ev.tone}">${esc(l.ev.label)}</div></div>
        <button class="btn btn-sm btn-danger" data-act="vacate" data-id="${l.id}">Vacate</button></div></div>`;
    }
    return `<div class="flex items-center justify-between gap-3 py-2.5">${left}<div class="flex items-center gap-2 shrink-0"><span class="pill pill-neutral">VACANT</span><button class="btn btn-sm btn-brand" data-act="assign" data-id="${r.id}" data-house="${r.houseId}">Assign tenant</button></div></div>`;
  }

  function renderHouses() {
    const hs = M.houses.filter((h) => h.propertyId === openProp);
    const list = $("houses-list");
    if (!hs.length) { list.innerHTML = PF.emptyState("properties", "No houses yet", "Add a 3-bedroom or 2-bedroom house to start letting rooms."); return; }
    list.innerHTML = hs.map((h) => {
      const st = PF.houseState(M, h), rs = st.rooms, cat = B.CATEGORIES[h.category];
      const whole = rs.reduce((s, r) => s + (r.rent || 0), 0);
      const modeLabel = { VACANT: "Vacant", WHOLE_HOUSE: "Whole house", BY_ROOM: "By room" }[st.mode];
      const wholeLease = st.mode === "WHOLE_HOUSE" ? M.leaseById[rs[0].leaseId] : null;
      return `<section class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div><h4 class="font-semibold">${esc(h.label)}</h4><p class="text-xs text-gray-500">${cat ? cat.label : "Single unit"} · whole house <span class="num font-medium">${formatKsh(whole)}</span>/mo</p></div>
          <span class="pill ${st.mode === "VACANT" ? "pill-neutral" : "pill-paid"}">${modeLabel}${st.mode === "BY_ROOM" ? ` · ${st.occupied}/${rs.length}` : ""}</span>
        </div>
        ${wholeLease ? `<div class="mt-3 rounded-xl bg-gray-50 p-3 flex items-center justify-between gap-3"><div><div class="text-sm font-medium">${esc(wholeLease.tenantName)} <span class="text-xs text-gray-500">holds all ${rs.length} rooms</span></div><div class="text-xs ${"txt-" + wholeLease.ev.tone}">${esc(wholeLease.ev.label)}</div></div><button class="btn btn-sm btn-danger" data-act="vacate" data-id="${wholeLease.id}">Vacate</button></div>`
          : `<div class="divide-line mt-2">${rs.map(roomRow).join("")}</div>`}
        <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--line)]">
          ${st.mode === "VACANT" && rs.length > 1 ? `<button class="btn btn-sm btn-soft" data-act="whole" data-house="${h.id}">Let whole house · ${formatKsh(whole)}</button>` : ""}
          ${st.mode === "VACANT" ? `<button class="btn btn-sm btn-danger" data-act="del-house" data-house="${h.id}">Delete house</button>` : ""}
        </div></section>`;
    }).join("");
  }

  $("houses-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act;
    if (a === "assign") { closeHouses(); Tenancy.openAssign({ houseId: b.dataset.house, roomId: b.dataset.id }); }
    if (a === "whole") { closeHouses(); Tenancy.openAssign({ houseId: b.dataset.house, mode: "WHOLE_HOUSE" }); }
    if (a === "vacate") Tenancy.openVacate(b.dataset.id);
    if (a === "rent") { editRoomId = b.dataset.id; const r = M.roomById[editRoomId]; $("rr-title").textContent = `${M.houseById[r.houseId].label} · ${r.label} (${r.tier})`; $("rr-amount").value = r.rent; PF.openModal("rent-modal"); }
    if (a === "del-house") delHouse(b.dataset.house);
  });

  $("rent-form").onsubmit = (e) => {
    e.preventDefault(); const n = parseFloat($("rr-amount").value);
    if (!(n > 0)) return showToast("Enter a valid rent", "error");
    const r = M.roomById[editRoomId], b = db.batch();
    b.update(db.collection("rooms").doc(editRoomId), { rent: n });
    const sibs = (M.roomsByHouse[r.houseId] || []).map((x) => (x.id === editRoomId ? n : x.rent));
    b.update(db.collection("houses").doc(r.houseId), { wholeHouseRent: sibs.reduce((s, x) => s + x, 0) });
    PF.closeModal("rent-modal");
    PF.fire(b.commit(), "Rent updated for future tenants", "Update failed");
  };

  async function delHouse(hid) {
    if (!(await PF.confirm({ title: "Delete this house?", message: "Its rooms will be removed. This can't be undone.", confirmText: "Delete", danger: true }))) return;
    const b = db.batch(); (M.roomsByHouse[hid] || []).forEach((r) => b.delete(db.collection("rooms").doc(r.id))); b.delete(db.collection("houses").doc(hid));
    PF.fire(b.commit(), "House deleted", "Delete failed");
  }

  /* ---- add a house to an existing property ---- */
  window.openAddHouse = function () { $("ah-form").reset(); $("ah-single").classList.add("hidden"); PF.openModal("addhouse-modal"); };
  $("ah-cat").onchange = () => $("ah-single").classList.toggle("hidden", $("ah-cat").value !== "SINGLE");
  $("ah-form").onsubmit = (e) => {
    e.preventDefault();
    const cat = $("ah-cat").value, n = Math.max(1, Math.min(40, +$("ah-count").value || 1)), sr = +$("ah-rent").value || 0;
    if (cat === "SINGLE" && sr <= 0) return showToast("Enter the unit rent", "error");
    const nums = M.houses.filter((h) => h.propertyId === openProp && (cat === "SINGLE" ? h.category === "SINGLE" : h.category !== "SINGLE")).map((h) => parseInt(String(h.label).replace(/\D/g, ""), 10) || 0);
    const existing = nums.length ? Math.max(...nums) : 0;
    PF.closeModal("addhouse-modal");
    PF.fire(commitOps(houseOps(openProp, auth.currentUser.uid, cat, n, existing + 1, sr)), `${n} house${n > 1 ? "s" : ""} added`, "Could not add house");
  };
})();
