# PropFlow KE

Room-level property management for Kenyan landlords. Firebase (Auth + Firestore + Hosting + Functions) and vanilla JS.

## What's inside
| Area | Files |
|---|---|
| Billing engine (anniversary due dates, OVERDUE / DUE SOON / PAID, cycle lock) | `public/js/billing.js` (+ `tests/billing.test.js`) |
| Houses & rooms (3BR tiered 9,500/8,500/7,500 = 25,500 · 2BR fixed 9,000×2 = 18,000 · single units) | `properties.js`, `tenancy.js` |
| Assign tenant, deposit (1× rent), vacate & re-let per room | `tenancy.js`, `tenants.js` |
| Payments: Paystack live, Daraja-ready adapter, idempotent writes | `payments.js`, `payments-page.js` |
| NVIDIA NIM: M-Pesa SMS parser, smart reminders | `ai-automation.js` + `api/_lib/handler.js` |
| Dashboard / Today command center | `dashboard.js` |
| Account (name, phone, business, avatar 256² WebP, password), Forgot password | `account.js`, `forgot-password/` |
| Maintenance tickets linked to rooms | `maintenance.js` |
| Tenant statement PDF (jsPDF + autotable) | `pdf-ledger.js` |
| Realtime store + offline cache | `store.js`, `firebase-config.js` |

## Run locally
```
npm install
npm run build:css      # compiles Tailwind (re-run after you add new classes)
npm test               # billing engine tests
```
Then serve the **`public`** folder (not the project root):
- **VS Code Live Server:** open the project folder and click *Go Live* — `.vscode/settings.json` already points it at `/public` on `127.0.0.1:5501`. (Or right-click `public/index.html` → *Open with Live Server*.)
- **Or:** `npm start` (serves `public` on http://127.0.0.1:5501).

Locally the Cloud Functions are not running, so: Paystack payments are logged as "unverified", the pay link page and AI polish need the deployed site, and the M-Pesa SMS reader falls back to on-device parsing. Everything else works.

## Deploy on Vercel (this is what fixes the pay-link 404)

The pay links, Paystack verification, tenant app and reminders are served by the `api/` folder (Vercel serverless functions). Firebase Functions are no longer used.

1. **Import the repo root** in Vercel. *Root Directory* = repo root (NOT `public`). *Framework* = Other. *Output Directory* = `public` (already set in `vercel.json`). Build command: none.
2. Add the environment variables from `.env.example` (Settings → Environment Variables), then **Redeploy**.
3. Firebase console → Authentication → Settings → **Authorized domains** → add `markhouse.vercel.app`.
4. Publish the security rules once: `npx firebase-tools deploy --only firestore:rules`.
5. Paystack → Settings → Webhooks → `https://markhouse.vercel.app/api/paystack/webhook`.
6. Push alerts: `npx web-push generate-vapid-keys`, put both keys in Vercel. On iPhone, push only works after "Add to Home Screen".
7. Daily reminders run from `vercel.json` (`/api/cron/daily`, 08:00 Nairobi). Vercel's free plan allows one run per day.

## Tenant app

* Landlord: **Tenants → Access & QR** (also opens right after you assign a tenant). It creates the tenant's login: **email you entered + phone number as the first password**.
* Tenant opens `https://markhouse.vercel.app/tenant/`, signs in, **must choose a new password**, then sees rent due, payment period, house, documents, history, and can pay or install the app.
* The QR code opens the login-free pay page for that one tenancy.
* When you **Vacate** a tenant, their login is switched off (and again overnight as a safety net). They can no longer sign in.
* Tenants get reminders 7 days, 3 days and on the due day, and when overdue; you are told when someone pays and about overdue rent. Tenant accounts have no access to the landlord screens or database.

## Without the API
If the API is not configured the app still works: payments are logged (Paystack ones flagged "unverified"), the M-Pesa SMS parser falls back to an on-device reader, and reminders omit the payment link.

## Archive & exports
- Anything older than 30 days (`PF.ARCHIVE_DAYS` in `store.js`) leaves the busy lists and appears under an **Archive** tab: payments (grouped by month), moved-out tenants, and maintenance requests resolved over 30 days ago.
- Archiving is a view, not a data move: nothing is deleted, the payment ledger stays immutable, and archived payments still count toward balances and tenant statements.
- **Download PDF** on Tenants (current tab + search) and on Payments (current view: last 30 days or archive).

## Billing rules
- Deposit = 1× monthly rent of the room (or whole house), recorded at move-in.
- At move-in the tenant pays the deposit AND the first month's rent (both logged automatically). Rent is then due on the same day each month. 29–31 clamp to the month's last day.
- OVERDUE: due date passed with a balance. DUE SOON: due within 3 days (or today). PAID: nothing owing.
- A cycle is locked once paid: the app refuses payments beyond one cycle ahead (no duplicate billing).

## Data model (Firestore)
`properties → houses → rooms`, `leases` (tenancy: mode `BY_ROOM`|`WHOLE_HOUSE`, `move_in_date`, `rent`, `deposit`), `tenants`, `payments` (`provider`, `provider_ref`, `mpesa_receipt`, `status`, `billing_cycle`, `type`), `maintenance`.
Adding M-Pesa Daraja later = implement `PaymentProcessor.providers.DARAJA.initiate` and a callback function that writes the same payment document. No schema change.

## Added in v2.2
- **Move-in collects deposit + first month's rent** (choose Cash / M-Pesa / Bank, or "Not received yet", which shows DUE TODAY then OVERDUE).
- **Tenant pay link, no login:** Remind → the message includes `/pay/?l=<lease>&t=<secret>`. The tenant sees the amount due and pays by M-Pesa or card via Paystack; the payment is verified server-side and the cycle locks. Needs the Functions deployed.
- **Receipts:** shown after every payment (WhatsApp text, PDF, copy) and from the Receipt button in the payments table.
- **Exports:** Account → Data & backup (Tenants / Payments / Rooms as CSV for Excel, plus a full JSON backup). CSV buttons also on Tenants and Payments.
- **Nightly backup:** `nightlyBackup` function writes each landlord's data to Cloud Storage at 02:00 Nairobi time, keeping 30 days (needs Storage enabled; consider turning on Firestore point-in-time recovery too).
- **Branded password reset:** in Firebase Console → Authentication → Templates → Password reset: set sender name "PropFlow KE", subject "Reset your PropFlow KE password", and under "Customize action URL" use `https://YOUR-DOMAIN/auth-action`. Reset links then open the PropFlow-styled page. (Email wording itself can only be changed in the console.)
- **Installable app:** service worker (`sw.js`) caches the app shell so pages open offline; Account → "Install on your phone" (Android/Chrome button, iPhone instructions).
- `api/_lib/billing.js` is a copy of `public/js/billing.js`; run `npm run sync` after editing the engine (`npm test` checks they match).

## Notes
- Data created by the previous version (`units`) is not migrated; add houses on the Properties page.
- Replace `support@propflow.ke` in the privacy/terms pages with your real contact address.
- The Paystack key in `firebase-config.js` is the public key only; keep the secret key in Functions secrets.
