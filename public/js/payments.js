/**
 * PropFlow KE — PaymentProcessor
 * One interface, many providers. Paystack is live today; M-Pesa Daraja (STK Push / C2B) plugs in
 * later by implementing the same adapter contract — the Firestore schema below already has the fields.
 *
 * Payment document (collection "payments") — provider-neutral:
 *   ownerId, leaseId, tenantId, tenantName, propertyId, houseId, houseLabel, roomIds[]
 *   amount (KES, number > 0), currency "KES", type "RENT" | "DEPOSIT"
 *   provider "PAYSTACK" | "DARAJA" | "MANUAL", provider_ref, mpesa_receipt, status "success" | "failed" | "pending"
 *   billing_cycle "YYYY-MM", paidAt "YYYY-MM-DD", verified (bool), note, createdAt
 *   method / reference  (legacy aliases kept for old screens)
 *
 * Adapter contract:  { id, label, enabled, initiate(ctx) -> Promise<{provider_ref}>, normalize(raw) -> partial payment }
 */
(function () {
  const PF = (window.PF = window.PF || {});
  const B = window.PFBilling;
  const CURRENCY = "KES";

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src)); document.head.appendChild(s);
    });
  }
  const tenantEmail = (lease) => lease.email || `${String(lease.phone || lease.tenantId || "tenant").replace(/\D/g, "") || "tenant"}@tenants.propflow.ke`;
  const newRef = (p) => `${p}_${Date.now()}_${Math.floor(Math.random() * 9e4 + 1e4)}`;

  /* ---------------- providers ---------------- */
  const providers = {
    PAYSTACK: {
      id: "PAYSTACK", label: "Paystack (card / M-Pesa)", enabled: true,
      /** Opens Paystack checkout. Resolves with {provider_ref} once the customer completes payment. */
      async initiate({ lease, amount, cycle }) {
        await loadScript("https://js.paystack.co/v1/inline.js");
        const ref = newRef("PF");
        return new Promise((resolve, reject) => {
          const h = window.PaystackPop.setup({
            key: PAYSTACK_PUBLIC_KEY, email: tenantEmail(lease), amount: Math.round(amount * 100), currency: CURRENCY, ref,
            metadata: {
              lease_id: lease.id, room_id: (lease.roomIds || []).join(","), billing_cycle: cycle, owner_id: lease.ownerId,
              custom_fields: [
                { display_name: "Tenant", variable_name: "tenant", value: lease.tenantName },
                { display_name: "Room", variable_name: "room", value: `${lease.houseLabel} · ${lease.roomLabels}` },
                { display_name: "Billing cycle", variable_name: "billing_cycle", value: cycle }
              ]
            },
            callback: (resp) => resolve({ provider_ref: resp.reference || ref }), // must be a plain function for Paystack
            onClose: () => reject(Object.assign(new Error("Payment window closed"), { cancelled: true }))
          });
          h.openIframe();
        });
      },
      /** charge.success payload -> partial payment (used by the webhook and verify endpoints server-side too) */
      normalize(raw) {
        return { provider: "PAYSTACK", provider_ref: raw.reference, amount: (raw.amount || 0) / 100, status: raw.status === "success" ? "success" : "failed" };
      }
    },
    DARAJA: {
      id: "DARAJA", label: "M-Pesa (Daraja STK Push)", enabled: false,
      async initiate() { throw new Error("M-Pesa Daraja is not enabled for this account yet."); },
      /** Safaricom callback body -> partial payment. Works for STK Push and C2B confirmation payloads. */
      normalize(cb) {
        const items = (cb.Body && cb.Body.stkCallback && cb.Body.stkCallback.CallbackMetadata && cb.Body.stkCallback.CallbackMetadata.Item) || [];
        const pick = (n) => (items.find((i) => i.Name === n) || {}).Value;
        return {
          provider: "DARAJA", provider_ref: (cb.Body && cb.Body.stkCallback && cb.Body.stkCallback.CheckoutRequestID) || cb.TransID,
          mpesa_receipt: pick("MpesaReceiptNumber") || cb.TransID, amount: Number(pick("Amount") || cb.TransAmount) || 0,
          status: ((cb.Body && cb.Body.stkCallback && cb.Body.stkCallback.ResultCode) === 0 || cb.TransID) ? "success" : "failed"
        };
      }
    },
    MANUAL: { id: "MANUAL", label: "Cash / M-Pesa (manual)", enabled: true, normalize: (r) => r }
  };

  /* ---------------- billing lock ---------------- */
  /** Can we accept `amount` of rent for this lease right now? Enforces one-payment-per-cycle locking. */
  function check(lease, amount) {
    const ev = lease.ev || B.evaluate(lease, lease.payments || []);
    if (ev.locked) return { ok: false, max: 0, reason: `${B.cycleLabel(ev.nextDue)} is already paid — this cycle is locked.`, ev };
    if (amount > ev.maxPayable + 0.001) return { ok: false, max: ev.maxPayable, reason: `Maximum collectable right now is ${B.fmt(ev.maxPayable)} (prevents duplicate billing).`, ev };
    return { ok: true, max: ev.maxPayable, ev };
  }

  /** Writes a payment. Idempotent on provider_ref (doc id = PROVIDER_ref). */
  function buildDoc(lease, f) {
    const ev = lease.ev || B.evaluate(lease, lease.payments || []);
    const type = f.type || "RENT";
    return {
      ownerId: lease.ownerId, leaseId: lease.id, tenantId: lease.tenantId, tenantName: lease.tenantName,
      propertyId: lease.propertyId || null, houseId: lease.houseId || null, houseLabel: lease.houseLabel || null, roomIds: lease.roomIds || [],
      amount: Number(f.amount), currency: CURRENCY, type,
      provider: f.provider || "MANUAL", provider_ref: f.provider_ref || null, mpesa_receipt: f.mpesa_receipt || null,
      status: f.status || "success", billing_cycle: type === "RENT" ? (f.billing_cycle || ev.targetCycleKey) : null,
      paidAt: f.paidAt || B.toISO(new Date()), verified: f.verified !== false, note: f.note || (type === "DEPOSIT" ? "Security deposit" : "Rent payment"),
      method: (f.provider || "MANUAL").toLowerCase(), reference: f.provider_ref || f.mpesa_receipt || null,
      createdAt: PF.ts()
    };
  }

  function record(lease, f) {
    const type = f.type || "RENT";
    if (!(Number(f.amount) > 0)) return Promise.reject(new Error("Enter a valid amount"));
    if (type === "RENT") { const c = check(lease, Number(f.amount)); if (!c.ok) return Promise.reject(new Error(c.reason)); }
    const model = PF.model();
    const dupRef = f.provider_ref || f.mpesa_receipt;
    if (dupRef && model.payments.some((p) => p.provider_ref === dupRef || p.mpesa_receipt === dupRef)) return Promise.reject(new Error(`Reference ${dupRef} is already logged.`));
    const doc = buildDoc(lease, f);
    const id = dupRef ? `${doc.provider}_${String(dupRef).replace(/[^\w-]/g, "")}` : null;
    const ref = id ? db.collection("payments").doc(id) : db.collection("payments").doc();
    return ref.set(doc).then(() => ({ id: ref.id, ...doc }));
  }

  /** Live checkout. Verifies server-side (secret key) and falls back to a flagged client record if the API is not deployed. */
  async function payWithPaystack(lease, amount) {
    const c = check(lease, amount); if (!c.ok) throw new Error(c.reason);
    const cycle = c.ev.targetCycleKey;
    const { provider_ref } = await providers.PAYSTACK.initiate({ lease, amount, cycle });
    try {
      const r = await apiCall("/paystack/verify", { reference: provider_ref });
      return { verified: true, payment: r.payment };
    } catch (e) {
      if ([400, 401, 403, 409].includes(e.status)) throw e; // genuine rejection; anything else = backend not deployed/reachable
      const p = await record(lease, { amount, provider: "PAYSTACK", provider_ref, billing_cycle: cycle, verified: false, note: "Paystack (awaiting server verification)" });
      return { verified: false, payment: p };
    }
  }

  /** Hosted payment link (for reminders) — created server-side so the secret key never touches the browser. */
  async function createPaymentLink(lease, amount) {
    try {
      const ev = lease.ev || B.evaluate(lease, lease.payments || []);
      const r = await apiCall("/paystack/init", { leaseId: lease.id, amount, billing_cycle: ev.targetCycleKey, callback: location.origin + "/payments" });
      return r.url || null;
    } catch (e) { return null; }
  }

  window.PaymentProcessor = { CURRENCY, providers, check, record, payWithPaystack, createPaymentLink, buildDoc, tenantEmail };
})();
