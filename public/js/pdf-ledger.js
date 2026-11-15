/**
 * PropFlow KE — Tenant Statement PDF (jsPDF + jspdf-autotable, loaded on demand).
 *   PDFLedger.download(lease, { landlord, business })
 */
(function () {
  const B = window.PFBilling;
  const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  const AUTOTABLE = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load PDF library (check your connection)")); document.head.appendChild(s);
    });
  }
  const money = (n) => B.fmt(n).replace("KSh ", "");
  const BRAND = [225, 29, 72], INK = [17, 24, 39], MUTED = [107, 114, 128], LINE = [229, 231, 235];

  /** Builds the jsPDF document (pure — pass jsPDF constructor so it can be tested in Node). */
  function build(jsPDFCtor, lease, opts = {}) {
    const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 40;
    const today = B.startOfDay();
    const ev = lease.ev || B.evaluate(lease, lease.payments || [], today);
    const rows = B.ledger(lease, lease.payments || [], today);
    const business = opts.business || "PropFlow KE";

    // Header band
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 78, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text(business, M, 38);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(opts.landlord ? `Landlord: ${opts.landlord}` : "Property management", M, 56);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("TENANT STATEMENT", W - M, 38, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(`Generated ${today.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}`, W - M, 56, { align: "right" });
    doc.setFontSize(8); doc.text("Powered by PropFlow KE", W - M, 69, { align: "right" });

    // Tenant / tenancy details (two columns)
    let y = 104;
    const detail = (x, label, value) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(label.toUpperCase(), x, y);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(String(value || "—"), x, y + 14);
    };
    const c2 = W / 2 + 10;
    detail(M, "Tenant", lease.tenantName); detail(c2, "Property", `${lease.propertyName || ""} · ${lease.houseLabel || ""}`.replace(/^ · /, "")); y += 38;
    detail(M, "Phone", lease.phone); detail(c2, "Room / tier", `${lease.mode === "WHOLE_HOUSE" ? "Whole house — " : ""}${lease.roomLabels || ""}`); y += 38;
    detail(M, "Move-in date", B.fmtDate(B.parseISO(lease.move_in_date))); detail(c2, "Monthly rent", B.fmt(lease.rent)); y += 38;
    detail(M, "Billing day", `${B.ordinal(ev.billingDay)} of every month`); detail(c2, "Security deposit held", B.fmt(lease.depositPaid || lease.deposit)); y += 30;

    // Status box
    const tone = { paid: [5, 150, 105], due: [180, 83, 9], late: [220, 38, 38] }[ev.tone];
    const bg = { paid: [236, 253, 245], due: [255, 251, 235], late: [254, 242, 242] }[ev.tone];
    doc.setFillColor(...bg); doc.setDrawColor(...tone); doc.roundedRect(M, y, W - 2 * M, 48, 6, 6, "FD");
    doc.setTextColor(...tone); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`CURRENT CYCLE: ${ev.status === "DUE_SOON" ? "DUE SOON" : ev.status}${ev.status === "PAID" && ev.locked ? "  ·  LOCKED" : ""}`, M + 14, y + 20);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK);
    doc.text(ev.label + (ev.status === "PAID" ? "" : `  ·  next due ${B.fmtDate(ev.status === "OVERDUE" ? ev.targetDue : ev.nextDue)}`), M + 14, y + 36);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text("BALANCE DUE", W - M - 14, y + 20, { align: "right" });
    doc.setFontSize(14); doc.setTextColor(...INK); doc.text(`KSh ${money(ev.owed)}`, W - M - 14, y + 38, { align: "right" });
    y += 66;

    // Ledger
    const body = rows.map((r) => [
      r.date.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }),
      r.desc, r.debit ? money(r.debit) : "", r.kind === "DEPOSIT" ? `(${money(r.memo)})` : r.credit ? money(r.credit) : "", money(r.balance)
    ]);
    if (!body.length) body.push(["—", "No rent has fallen due yet", "", "", "0"]);
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 54 },
      head: [["Date", "Description", "Charges (KSh)", "Payments (KSh)", "Balance (KSh)"]], body,
      theme: "plain", styles: { font: "helvetica", fontSize: 9, cellPadding: 6, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: [249, 250, 251], textColor: MUTED, fontStyle: "bold", fontSize: 8, lineWidth: { bottom: 1 }, lineColor: LINE },
      columnStyles: { 0: { cellWidth: 70 }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 85 }, 4: { halign: "right", cellWidth: 85, fontStyle: "bold" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index >= 2) d.cell.styles.halign = "right";
        if (d.section === "body" && d.column.index === 4) { const v = Number(String(d.cell.raw).replace(/,/g, "")); if (v > 0) d.cell.styles.textColor = [220, 38, 38]; }
        if (d.section === "body" && d.column.index === 3 && String(d.cell.raw).startsWith("(")) d.cell.styles.textColor = MUTED;
      }
    });
    y = doc.lastAutoTable.finalY + 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    const note = "Figures in brackets are the refundable security deposit and are not part of the rent balance. Rent is billed monthly on the move-in day.";
    doc.text(doc.splitTextToSize(note, W - 2 * M), M, y);

    // Footer on every page
    const pages = doc.internal.getNumberOfPages(), H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setDrawColor(...LINE); doc.line(M, H - 40, W - M, H - 40);
      doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(`${business} · Tenant statement for ${lease.tenantName}`, M, H - 26);
      doc.text(`Page ${i} of ${pages}`, W - M, H - 26, { align: "right" });
    }
    return doc;
  }

  /** Generic landscape table report (tenant list, payments). */
  function report(jsPDFCtor, { title, subtitle, summary, head, body, align = {}, widths = {} }, opts = {}) {
    const doc = new jsPDFCtor({ unit: "pt", format: "a4", orientation: "landscape" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36;
    const business = opts.business || "PropFlow KE";
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 64, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(business, M, 30);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(opts.landlord ? `Landlord: ${opts.landlord}` : "Property management", M, 47);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(title.toUpperCase(), W - M, 30, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`Generated ${B.fmtDate(new Date())}`, W - M, 47, { align: "right" });
    doc.setTextColor(...INK); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(subtitle || "", M, 88);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.setFontSize(9); doc.text(summary || "", M, 102);
    const cs = {}; head.forEach((_, i) => { cs[i] = { halign: align[i] || "left", ...(widths[i] ? { cellWidth: widths[i] } : {}) }; });
    doc.autoTable({
      startY: 114, margin: { left: M, right: M, bottom: 48 }, head: [head], body: body.length ? body : [["No records"].concat(Array(head.length - 1).fill(""))],
      theme: "plain", styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: [249, 250, 251], textColor: MUTED, fontStyle: "bold", fontSize: 7.5, lineWidth: { bottom: 1 }, lineColor: LINE },
      columnStyles: cs,
      didParseCell: (d) => {
        if (d.section === "head") d.cell.styles.halign = align[d.column.index] || "left";
        const t = String(d.cell.raw || "");
        if (d.section === "body" && /OVERDUE/.test(t)) { d.cell.styles.textColor = [220, 38, 38]; d.cell.styles.fontStyle = "bold"; }
        else if (d.section === "body" && /DUE SOON|Due /.test(t)) d.cell.styles.textColor = [180, 83, 9];
        else if (d.section === "body" && /^PAID/.test(t)) d.cell.styles.textColor = [5, 150, 105];
      }
    });
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setDrawColor(...LINE); doc.line(M, H - 34, W - M, H - 34); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(`${business} · ${title}`, M, H - 20); doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: "right" });
    }
    return doc;
  }

  function buildTenants(jsPDFCtor, leases, opts = {}) {
    const rows = leases.map((l, i) => {
      const ev = l.ev, ended = l.status === "ENDED";
      const st = ended ? `MOVED OUT${l.move_out_date ? " " + B.fmtDate(B.parseISO(l.move_out_date)) : ""}` : ev.status === "OVERDUE" ? `OVERDUE · ${ev.daysLate}d` : ev.status === "DUE_SOON" ? "DUE SOON" : "PAID";
      return [String(i + 1), l.tenantName, l.phone || "", `${l.propertyName || ""} · ${l.houseLabel || ""} · ${l.mode === "WHOLE_HOUSE" ? "Whole house" : l.roomLabels || ""}`, money(l.rent), ended ? "—" : B.ordinal(ev.billingDay), B.fmtDate(B.parseISO(l.move_in_date)), money(l.depositPaid || l.deposit), st, ended ? "—" : money(ev.owed)];
    });
    const active = leases.filter((l) => l.status === "ACTIVE");
    const owed = active.reduce((s, l) => s + (l.ev.owed || 0), 0), late = active.filter((l) => l.ev.status === "OVERDUE").length;
    return report(jsPDFCtor, {
      title: "Tenant list", subtitle: opts.label || "Tenants",
      summary: `${leases.length} tenant${leases.length === 1 ? "" : "s"}  ·  monthly rent ${B.fmt(active.reduce((s, l) => s + l.rent, 0))}  ·  ${late} overdue  ·  amount owing ${B.fmt(owed)}`,
      head: ["#", "Tenant", "Phone", "Property · House · Room", "Rent (KSh)", "Due day", "Move-in", "Deposit (KSh)", "Status", "Owing (KSh)"], body: rows,
      align: { 0: "right", 4: "right", 7: "right", 9: "right" }, widths: { 0: 24, 4: 62, 5: 44, 7: 66, 9: 66 }
    }, opts);
  }
  function buildPayments(jsPDFCtor, pays, opts = {}) {
    const rows = pays.map((p) => [B.fmtDate(p.paidAtDate || B.parseISO(p.paidAt || B.toISO(new Date()))), p.tenantName || "", p.houseLabel || "—", p.type === "DEPOSIT" ? "Deposit" : "Rent" + (p.billing_cycle ? " " + p.billing_cycle : ""), (p.provider || p.method || "manual").toString().toUpperCase(), p.mpesa_receipt || p.provider_ref || "—", money(p.amount)]);
    const total = pays.filter((p) => (p.type || "RENT") === "RENT").reduce((s, p) => s + (p.amount || 0), 0);
    return report(jsPDFCtor, { title: "Payments", subtitle: opts.label || "Payments", summary: `${pays.length} payment${pays.length === 1 ? "" : "s"}  ·  rent received ${B.fmt(total)}`,
      head: ["Date", "Tenant", "House", "For", "Method", "Reference", "Amount (KSh)"], body: rows, align: { 6: "right" }, widths: { 6: 80 } }, opts);
  }
  function buildReceipt(jsPDFCtor, r) {
    const doc = new jsPDFCtor({ unit: "pt", format: "a5" });
    const W = doc.internal.pageSize.getWidth(), M = 32;
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 70, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(r.business, M, 34);
    doc.setFontSize(9.5); doc.setFont("helvetica", "normal"); doc.text("PAYMENT RECEIPT", M, 52); doc.text(`No. ${r.no}`, W - M, 52, { align: "right" });
    let y = 104; doc.setTextColor(...MUTED); doc.setFontSize(8.5); doc.text("RECEIVED WITH THANKS FROM", M, y);
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(r.tenantName, M, y + 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text([r.house, r.room].filter(Boolean).join(" · "), M, y + 34);
    y += 64; doc.setFillColor(249, 250, 251); doc.setDrawColor(...LINE); doc.roundedRect(M, y, W - 2 * M, 62, 6, 6, "FD");
    doc.setTextColor(...MUTED); doc.setFontSize(8.5); doc.text("AMOUNT", M + 14, y + 20);
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text(B.fmt(r.amount), M + 14, y + 46);
    y += 86;
    const rows = [["For", r.type === "DEPOSIT" ? "Security deposit" : "Rent" + (r.cycle ? " — " + r.cycle : "")], ["Date paid", B.fmtDate(r.date)], ["Paid via", r.via]];
    if (r.type === "RENT" && r.nextDue) { rows.push(["Balance", r.balance > 0 ? B.fmt(r.balance) : "Nil — rent up to date"], ["Next rent due", B.fmtDate(r.nextDue)]); }
    rows.forEach(([k, v]) => { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...MUTED); doc.text(k, M, y); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.text(String(v), W - M, y, { align: "right" }); doc.setDrawColor(...LINE); doc.line(M, y + 7, W - M, y + 7); y += 24; });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Issued by ${r.landlord || r.business} · generated with PropFlow KE`, W / 2, doc.internal.pageSize.getHeight() - 28, { align: "center" });
    return doc;
  }
  async function downloadReceipt(r) { await loadScript(JSPDF); buildReceiptSave(r); }
  function buildReceiptSave(r) { buildReceipt(window.jspdf.jsPDF, r).save(`Receipt_${r.no}.pdf`); }

  async function save(builder, data, opts, name) {
    await loadScript(JSPDF); await loadScript(AUTOTABLE);
    builder(window.jspdf.jsPDF, data, opts).save(`PropFlow_${name}_${B.toISO(new Date())}.pdf`);
  }
  const downloadTenants = (leases, opts) => save(buildTenants, leases, opts, "Tenant_List");
  const downloadPayments = (pays, opts) => save(buildPayments, pays, opts, "Payments");

  async function download(lease, opts = {}) {
    await loadScript(JSPDF); await loadScript(AUTOTABLE);
    const doc = build(window.jspdf.jsPDF, lease, opts);
    const safe = String(lease.tenantName || "tenant").replace(/[^\w]+/g, "_");
    doc.save(`PropFlow_Statement_${safe}_${B.toISO(new Date())}.pdf`);
  }

  const api = { build, download, buildReceipt, downloadReceipt, buildTenants, buildPayments, downloadTenants, downloadPayments };
  if (typeof module === "object" && module.exports) module.exports = api; else window.PDFLedger = api;
})();
