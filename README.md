# `join-date-mapping` Serverless Function

## Purpose

Better World Club (BWC) relies on Stripe Checkout for paid memberships, but **HubSpot CMS Enterprise** lacks built‑in automation to stamp an official `join_date` on the corresponding Contact at the moment payment clears. The `join‑date‑mapping` serverless function fills that gap by listening for Stripe **`checkout.session.completed`** events and writing an **immutable** `join_date` value—ensuring reporting, support eligibility, and renewal logic all reference the exact membership start time.

Without this function, BWC staff would have to monitor Stripe receipts manually and backfill dates, leading to inconsistent analytics and delayed roadside‑assistance coverage.

---

## What It Does

1. **Receives a Stripe webhook payload** (`checkout.session.completed`), verified with Stripe‑signature header.
2. **Returns an immediate `204`** so Stripe does not retry due to timeout, then routes processing to an asynchronous handler.
3. **Extracts the customer email & payment timestamp** from the session.
4. **Finds (or creates) the matching Contact** in HubSpot using the email address.
5. **Checks if `join_date` is already set.** If present, exits idempotently to prevent accidental overwrites.
6. **Writes `join_date` and `join_date_source`** to the Contact via `PATCH /crm/v3/objects/contacts/{id}`.  *`join_date_source` helps trace provenance for audits.*
7. **Logs a concise outcome object** (success / already\_set / error) for audit dashboards.

### Key Property Mapping

| Contact Property      | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `join_date`           | ISO‑8601 date (no time) in **America/Chicago** derived from Stripe timestamp |
| `join_date_source`    | "stripe\_checkout"                                                           |
| `stripe_customer_id`  | (optional) session.customer                                                  |
| `stripe_subscription` | (optional) subscription ID if available                                      |

---

## Trigger & Entry Point

```js
exports.main = async (context, sendResponse) => {
  /* verify Stripe signature, then process */
};
```

The file lives in **HubSpot → CRM Development → Functions** and is invoked directly by Stripe’s webhook endpoint URL.

---

## Environment Variables / Secrets

| Name               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `stripeSigningKey` | Webhook secret for signature verification                      |
| `hsPrivateToken`   | HubSpot private‑app token (`crm.objects.contacts.write` scope) |
| `tz` (optional)    | Time‑zone override; defaults to `America/Chicago`              |

---

## Idempotency & Error Handling

* **Write‑Once Rule:** If `join_date` already exists, the function exits with status `already_set`.
* **400/422 Handling:** Malformed payloads or signature failures return `400`, causing Stripe to retry.
* **Retry Window:** Stripe retries up to 3 days; the function is stateless and safe for re‑invocation.

---

## Response Schema (Logged)

```json
{
  "contactId": "104951",
  "status": "success | already_set | error",
  "joinDate": "2025-07-20",
  "stripeSession": "cs_test_a1B2C3",
  "errors": []
}
```

