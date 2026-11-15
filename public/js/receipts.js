/** PropFlow KE — payment receipts: WhatsApp / copy / PDF. */
(function () {
  const B = PFBilling;
  const $ = (r, s) => r.querySelector(s);

  function make(p, lease) {
    lease = lease || (p.leaseId && PF.model().leaseById[p.leaseId]) || null;
    let after = null;
    if (lease && lease.status === "ACTIVE") { const pays = (lease.payments || []).filter((x) => x.id !== p.id).concat([{ ...p, status: "success" }]); after = B.evaluate(lease, pays, B.startOfDay()); }
    const d = p.paidAtDate || (p.paidAt ? B.parseISO(p.paidAt) : B.startOfDay());
    const via = p.mpesa_receipt ? `M-Pesa ${p.mpesa_receipt}` : p.provider_ref ? `${(p.provider || "").charAt(0) + (p.provider || "").slice(1).toLowerCase()} ${p.provider_ref}` : "Cash";
    return {
      no: "PF-" + String(p.id || Date.now()).replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase(),
      tenantName: p.tenantName || (lease && lease.tenantName) || "Tenant", phone: lease && lease.phone,
      house: p.houseLabel || (lease && lease.houseLabel) || "", room: lease && lease.roomLabels || "",
      amount: p.amount, type: p.type || "RENT", cycle: p.billing_cycle, date: d, via,
      balance: after ? after.outstandingLate + (after.nextDue <= B.startOfDay() ? after.nextBalance : 0) : null, nextDue: after ? after.nextDue : null,
      business: (PF.profile && PF.profile.businessName) || "PropFlow KE", landlord: PF.profile && PF.profile.fullName
    };
  }
  function text(r) {
    const what = r.type === "DEPOSIT" ? "security deposit" : "rent" + (r.cycle ? ` (${r.cycle})` : "");
    return `Receipt ${r.no} — ${r.business}\nReceived with thanks from ${r.tenantName}: ${B.fmt(r.amount)} for ${what}.\n${[r.house, r.room].filter(Boolean).join(" · ")}\nPaid ${B.fmtDate(r.date)} via ${r.via}.` +
      (r.type === "RENT" && r.nextDue ? `\n${r.balance > 0 ? "Balance: " + B.fmt(r.balance) + "." : "Rent is up to date."} Next rent due ${B.fmtDate(r.nextDue)}.` : "") + "\nThank you.";
  }
  function show(p, lease) {
    const r = make(p, lease);
    let el = document.getElementById("receipt-modal");
    if (!el) { el = document.createElement("div"); el.id = "receipt-modal"; el.className = "modal"; document.body.appendChild(el); }
    el.innerHTML = `<div class="sheet max-w-md">
      <div class="p-6 text-center border-b border-[var(--line)]">
        <div class="w-12 h-12 rounded-2xl bg-[var(--paid-bg)] text-[var(--paid)] flex items-center justify-center mx-auto mb-3"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M5 13l4 4L19 7"/></svg></div>
        <h2 class="text-lg font-semibold">Payment recorded</h2><p class="text-2xl font-bold num mt-1">${B.fmt(r.amount)}</p><p class="text-sm text-gray-500">${esc(r.tenantName)} · ${esc(r.house)} ${esc(r.room)}</p></div>
      <div class="p-5 space-y-3">
        <pre id="rc-text" class="text-xs bg-gray-50 border border-[var(--line)] rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed">${esc(text(r))}</pre>
        <div class="grid grid-cols-2 gap-2"><button class="btn btn-wa" data-a="wa" ${r.phone ? "" : "disabled"}>Send on WhatsApp</button><button class="btn" data-a="pdf">Receipt PDF</button><button class="btn" data-a="copy">Copy text</button><button class="btn" data-a="close">Done</button></div>
        <p class="hint text-center">Receipt ${esc(r.no)}</p></div></div>`;
    el.onclick = async (e) => {
      const b = e.target.closest("[data-a]"); const a = b && b.dataset.a; if (!a) return;
      if (a === "close") PF.closeModal("receipt-modal");
      if (a === "wa") window.open(`https://wa.me/${PF.msisdn(r.phone)}?text=${encodeURIComponent(text(r))}`, "_blank", "noopener");
      if (a === "copy") { try { await navigator.clipboard.writeText(text(r)); showToast("Copied", "success"); } catch (x) { showToast("Select the text and copy it", "info"); } }
      if (a === "pdf") { b.disabled = true; try { await PDFLedger.downloadReceipt(r); } catch (x) { showToast(x.message, "error"); } b.disabled = false; }
    };
    PF.openModal("receipt-modal");
  }
  window.Receipts = { make, text, show };
})();
