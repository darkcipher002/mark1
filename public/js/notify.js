/** PropFlow KE — landlord notification bell + panel (live from Firestore) and push opt-in. */
(function () {
  const PF = (window.PF = window.PF || {});
  let items = [], open = false;
  const ico = { payment: "💰", late: "⚠️", digest: "📋", info: "🔔" };
  const ago = (d) => { const s = (Date.now() - d) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };

  function mountUI() {
    const slot = document.getElementById("hdr-pill"); if (!slot || document.getElementById("bell")) return;
    const w = document.createElement("div"); w.className = "relative";
    w.innerHTML = `<button id="bell" class="relative p-2 rounded-full hover:bg-gray-100" aria-label="Notifications" aria-expanded="false"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0"/></svg><span id="bell-n" class="hidden absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center"></span></button>
      <div id="bell-panel" class="hidden fixed sm:absolute inset-x-3 sm:inset-x-auto sm:right-0 top-[68px] sm:top-full sm:mt-2 sm:w-96 bg-white rounded-2xl border border-[var(--line)] shadow-xl z-50 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]"><b class="text-sm">Notifications</b><button id="bell-read" class="text-xs font-semibold text-brand-600">Mark all read</button></div>
        <div id="bell-list" class="max-h-[60vh] overflow-y-auto"></div><div id="bell-push" class="hidden border-t border-[var(--line)] p-3"></div></div>`;
    slot.parentNode.insertBefore(w, slot);
    $("bell").onclick = (e) => { e.stopPropagation(); toggle(); };
    $("bell-read").onclick = markAll;
    document.addEventListener("click", (e) => { if (open && !e.target.closest("#bell-panel")) toggle(false); });
    $("bell-list").addEventListener("click", (e) => { const r = e.target.closest("[data-id]"); if (!r) return; const n = items.find((x) => x.id === r.dataset.id); if (n && !n.read) db.collection("notifications").doc(n.id).update({ read: true }).catch(() => {}); if (n && n.url) location.href = n.url; });
  }
  const $ = (id) => document.getElementById(id);
  function toggle(v) { open = v === undefined ? !open : v; $("bell-panel").classList.toggle("hidden", !open); $("bell").setAttribute("aria-expanded", open); if (open) pushRow(); }
  function markAll() { items.filter((n) => !n.read).forEach((n) => db.collection("notifications").doc(n.id).update({ read: true }).catch(() => {})); }
  function paint() {
    const un = items.filter((n) => !n.read).length, b = $("bell-n"); if (!b) return;
    b.textContent = un > 9 ? "9+" : un; b.classList.toggle("hidden", !un);
    $("bell-list").innerHTML = items.length ? items.map((n) => `<button data-id="${n.id}" class="w-full text-left flex gap-3 px-4 py-3 hover:bg-gray-50 border-b border-[var(--line)] ${n.read ? "" : "bg-brand-50/50"}"><span class="text-lg leading-none mt-0.5">${ico[n.type] || ico.info}</span><span class="min-w-0 flex-1"><span class="block text-sm font-semibold">${esc(n.title)}</span><span class="block text-sm text-gray-500">${esc(n.body)}</span><span class="block text-[11px] text-gray-400 mt-0.5">${ago(n.at)}</span></span></button>`).join("")
      : `<div class="p-8 text-center text-sm text-gray-500">You're all caught up.<br/>You'll be told here when a tenant pays or rent runs late.</div>`;
  }
  async function pushRow() {
    const el = $("bell-push"); if (!window.PFPush) return; const st = await PFPush.state();
    if (st === "on" || st === "unsupported") return el.classList.add("hidden");
    el.classList.remove("hidden");
    el.innerHTML = st === "blocked" ? `<p class="text-xs text-gray-500">Alerts are blocked in your browser settings.</p>` : `<button id="push-on" class="btn btn-soft w-full">Get alerts on this device</button>`;
    const b = $("push-on"); if (b) b.onclick = async () => { b.disabled = true; try { await PFPush.enable(); showToast("Alerts are on for this device", "success"); el.classList.add("hidden"); } catch (e) { showToast(e.message, "error"); b.disabled = false; } };
  }
  PF.startNotify = function (user) {
    mountUI();
    db.collection("notifications").where("ownerId", "==", user.uid).limit(60).onSnapshot((s) => {
      items = s.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().getTime() : Date.now() }; }).sort((a, b) => b.at - a.at).slice(0, 30);
      paint();
    }, () => {});
    if (window.PFPush) { PFPush.refresh(); pushCard(); }
  };
  async function pushCard() {
    const b = $("push-btn"); if (!b) return; const t = $("push-text");
    const paint = async () => { const st = await PFPush.state();
      if (st === "unsupported") { $("push-card").classList.add("hidden"); return; }
      b.disabled = st === "blocked"; b.textContent = st === "on" ? "Turn off alerts" : st === "blocked" ? "Blocked in browser settings" : "Turn on alerts";
      t.textContent = st === "on" ? "Alerts are on for this device." : st === "blocked" ? "Allow notifications for this site in your browser or phone settings." : "Get a notification when a tenant pays or rent runs late."; };
    b.onclick = async () => { b.disabled = true; try { if ((await PFPush.state()) === "on") await PFPush.disable(); else await PFPush.enable(); } catch (e) { showToast(e.message, "error"); } paint(); };
    paint();
  }
})();
