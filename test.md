# Vaulte Backend — Complete Testing Guide

Everything you need to test every endpoint from scratch, including webhook testing with ngrok.

---

## Before You Start

### Variables you will use throughout this guide

Replace these with your actual values:

```
BASE_URL=http://localhost:3000
NGROK_URL=https://xxxx-xxxx-xxxx.ngrok-free.app
TOKEN=           # filled in after Step 2 (register)
VENDOR_ID=       # filled in after Step 2
TX_ID=           # filled in after Step 5 (create escrow)
CONFIRM_TOKEN=   # filled in after Step 5
VA_NUMBER=       # filled in after Step 5 (Squad VA account number)
```

### .env setup for local testing

Two modes are available. Pick one:

**Mode A — Full mock (no Squad API, no AI needed)**
```env
SQUAD_SKIP_BANK_VERIFICATION=true
AI_ENABLED=false
NODE_ENV=development
```
Everything works with mocked responses. No external dependencies.

**Mode B — Squad sandbox + AI disabled**
```env
SQUAD_SKIP_BANK_VERIFICATION=false
AI_ENABLED=false
SQUAD_SECRET_KEY=sandbox_sk_...
SQUAD_BASE_URL=https://sandbox-api-d.squadco.com
SQUAD_WEBHOOK_SECRET=your_webhook_secret
NODE_ENV=development
```
Real Squad API calls, AI mocked. You must have a funded sandbox account and ngrok running.

**Mode C — Full live (Squad sandbox + AI service running)**
```env
SQUAD_SKIP_BANK_VERIFICATION=false
AI_ENABLED=true
AI_SERVICE_URL=http://localhost:8000
```
Start the Python AI microservice first before running the backend.

---

## Step 0 — Start the server

```bash
npm run dev
```

Verify it started:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "vaulte-backend",
  "environment": "development",
  "ai_enabled": false,
  "squad_mode": "mock",
  "timestamp": "..."
}
```

---

## Step 1 — Get the bank list

Use this to find valid `payout_bank_code` values.

```bash
curl http://localhost:3000/api/vendors/banks
```

Expected:
```json
{
  "status": "success",
  "data": {
    "banks": [
      { "code": "000013", "name": "GTBank Plc" },
      { "code": "000014", "name": "Access Bank" },
      ...
    ]
  }
}
```

---

## Step 2 — Register a vendor

**Method:** `POST`
**URL:** `http://localhost:3000/api/vendors/register`
**Headers:** `Content-Type: application/json`

```bash
curl -X POST http://localhost:3000/api/vendors/register \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Ada Fashion Store",
    "category": "Fashion",
    "phone": "+2348012345678",
    "nin": "12345678901",
    "payout_account_number": "0123456789",
    "payout_bank_code": "000013",
    "location_state": "Lagos"
  }'
```

Expected response:
```json
{
  "status": "success",
  "message": "Vendor registered. Complete AI verification to activate your account.",
  "data": {
    "vendor": {
      "id": "abc123...",
      "business_name": "Ada Fashion Store",
      "trust_score": 0,
      "score_tier": "Unverified",
      "verification_status": "pending"
    },
    "api_key": "aabbcc...",
    "token": "eyJhbGci..."
  }
}
```

**Save the token and vendor id:**
```bash
TOKEN="eyJhbGci..."
VENDOR_ID="abc123..."
```

> **If `SQUAD_SKIP_BANK_VERIFICATION=false`:** The `payout_account_number` and `payout_bank_code` must be real accounts verifiable via Squad's sandbox. If the account lookup fails, you will get a 422. Switch to `SQUAD_SKIP_BANK_VERIFICATION=true` for initial testing.

---

## Step 3 — Start AI verification session

**Method:** `POST`
**URL:** `http://localhost:3000/api/vendors/verify/start`
**Headers:** `Authorization: Bearer $TOKEN`

```bash
curl -X POST http://localhost:3000/api/vendors/verify/start \
  -H "Authorization: Bearer $TOKEN"
```

Expected:
```json
{
  "status": "success",
  "data": {
    "session_id": "a1b2c3d4e5f6...",
    "instructions": {
      "step_1": "Hold your NIN slip or valid government ID visible to the camera",
      "step_2": "Blink 2 times when prompted",
      "step_3": "Turn head LEFT then RIGHT when prompted"
    },
    "expires_in_minutes": 10
  }
}
```

Save the session_id:
```bash
SESSION_ID="a1b2c3d4e5f6..."
```

---

## Step 4 — Submit verification frame

**Method:** `POST`
**URL:** `http://localhost:3000/api/vendors/verify/frame`

When `AI_ENABLED=false`, the frame content does not matter — pass any base64 string.

```bash
curl -X POST http://localhost:3000/api/vendors/verify/frame \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION_ID\",
    \"frame_base64\": \"dGVzdGZyYW1l\"
  }"
```

Expected:
```json
{
  "status": "success",
  "data": {
    "progress": "processing",
    "face_distance": 0.38,
    "blink_detected": false,
    "head_yaw": 0,
    "frame_count": 1
  }
}
```

---

## Step 5 — Complete verification

**Method:** `POST`
**URL:** `http://localhost:3000/api/vendors/verify/complete`

```bash
curl -X POST http://localhost:3000/api/vendors/verify/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SESSION_ID\"}"
```

Expected (with `AI_ENABLED=false`):
```json
{
  "status": "success",
  "message": "Identity verified.",
  "data": {
    "verification_status": "passed",
    "confidence_percent": 87.5,
    "trust_score": 30,
    "score_tier": "Basic Verified"
  }
}
```

The vendor's trust score has been initialized and they can now accept payments.

---

## Step 6 — Get Trust Score

**Method:** `GET`
**URL:** `http://localhost:3000/api/vendors/me/score`

```bash
curl http://localhost:3000/api/vendors/me/score \
  -H "Authorization: Bearer $TOKEN"
```

Expected:
```json
{
  "status": "success",
  "data": {
    "vendor_id": "...",
    "business_name": "Ada Fashion Store",
    "trust_score": 30,
    "score_tier": "Basic Verified",
    "verification_status": "passed",
    "score_frozen": false,
    "score_history": [...]
  }
}
```

---

## Step 7 — Public Trust Score (no auth needed, for buyer display)

**Method:** `GET`
**URL:** `http://localhost:3000/api/vendors/:id/score`

```bash
curl http://localhost:3000/api/vendors/$VENDOR_ID/score
```

---

## Step 8 — Create Escrow (the core flow)

**Method:** `POST`
**URL:** `http://localhost:3000/api/escrow/create`
**Headers:** `Authorization: Bearer $TOKEN`

```bash
curl -X POST http://localhost:3000/api/escrow/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 35000,
    "item_description": "Custom Ankara dress",
    "buyer_phone": "+2348099999999",
    "buyer_email": "buyer@test.com"
  }'
```

Expected:
```json
{
  "status": "success",
  "message": "Escrow created. Share the checkout URL with your buyer.",
  "data": {
    "transaction_id": "uuid...",
    "escrow_status": "pending",
    "amount": 35000,
    "item_description": "Custom Ankara dress",
    "squad_va_account": "DEV12345678",
    "checkout_url": "http://localhost:5174/checkout/uuid...",
    "confirmation_token": "abcdef...",
    "confirmation_expires_at": "2026-...",
    "sandbox_simulate_url": "POST https://sandbox-api-d.squadco.com/virtual-account/simulate/payment ..."
  }
}
```

Save:
```bash
TX_ID="uuid..."
CONFIRM_TOKEN="abcdef..."
VA_NUMBER="DEV12345678"
```

---

## Step 9 — Trigger payment (simulate webhook)

This step moves the transaction from `pending` to `funded`.

### Option A: Use the test route (works in all modes)

```bash
curl -X POST http://localhost:3000/test/webhook/simulate-payment \
  -H "Content-Type: application/json" \
  -d "{\"transaction_id\": \"$TX_ID\"}"
```

Expected:
```json
{
  "status": "success",
  "data": {
    "transaction_id": "...",
    "simulated_event": "charge_successful",
    "gateway_ref": "SQTEST..._1_1",
    "next_step": "POST /api/escrow/confirm/abcdef..."
  }
}
```

### Option B: Use Squad sandbox simulate endpoint (Mode B/C only)

This fires a real Squad webhook to your ngrok URL:

```bash
curl -X POST https://sandbox-api-d.squadco.com/virtual-account/simulate/payment \
  -H "Authorization: Bearer $SQUAD_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"virtual_account_number\": \"$VA_NUMBER\",
    \"amount\": \"35000\"
  }"
```

Or via the test route:
```bash
curl -X POST http://localhost:3000/test/squad/simulate-payment \
  -H "Content-Type: application/json" \
  -d "{
    \"virtual_account_number\": \"$VA_NUMBER\",
    \"amount\": 35000
  }"
```

### Option C: Send a raw Squad webhook manually (for ngrok testing)

Generate the HMAC signature first:

```bash
PAYLOAD='{"Event":"charge_successful","TransactionRef":"'$TX_ID'","Body":{"amount":3500000,"transaction_ref":"'$TX_ID'","gateway_ref":"SQTEST'$(date +%s)'_1_1","transaction_status":"Success","email":"buyer@test.com","merchant_id":"TEST","currency":"NGN","transaction_type":"Transfer","merchant_amount":3500000,"created_at":"'$(date -u +%Y-%m-%dT%H:%M:%S)'"}}}'

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha512 -hmac "$SQUAD_WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/api/webhooks/squad \
  -H "Content-Type: application/json" \
  -H "x-squad-signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

Expected response from webhook:
```json
{
  "response_code": 200,
  "transaction_reference": "...",
  "response_description": "Success"
}
```

Verify the transaction is now funded:
```bash
curl http://localhost:3000/test/transaction/$TX_ID
```

Expected `escrow_status: "funded"`.

---

## Step 10 — Get transaction details (buyer view)

**Method:** `GET`
**URL:** `http://localhost:3000/api/escrow/confirm/:token`

```bash
curl http://localhost:3000/api/escrow/confirm/$CONFIRM_TOKEN
```

Expected:
```json
{
  "status": "success",
  "data": {
    "transaction_id": "...",
    "escrow_status": "funded",
    "amount": 35000,
    "item_description": "Custom Ankara dress",
    "vendor": {
      "business_name": "Ada Fashion Store",
      "trust_score": 30,
      "score_tier": "Basic Verified"
    }
  }
}
```

---

## Step 11 — Confirm delivery (triggers fund release)

**Method:** `POST`
**URL:** `http://localhost:3000/api/escrow/confirm/:token`

```bash
curl -X POST http://localhost:3000/api/escrow/confirm/$CONFIRM_TOKEN
```

Expected:
```json
{
  "status": "success",
  "message": "Delivery confirmed. Funds released to vendor.",
  "data": {
    "transaction_id": "...",
    "escrow_status": "released",
    "amount": 35000
  }
}
```

After this, the trust score should update. Verify:
```bash
curl http://localhost:3000/api/vendors/me/score \
  -H "Authorization: Bearer $TOKEN"
```

---

## Step 12 — Test Dispute Flow (run a fresh escrow then fund it, then dispute it)

First repeat Steps 8 and 9 to create a new funded transaction. Then:

**Method:** `POST`
**URL:** `http://localhost:3000/api/escrow/:id/dispute`

```bash
NEW_TX_ID="...new-transaction-id..."

curl -X POST http://localhost:3000/api/escrow/$NEW_TX_ID/dispute \
  -H "Content-Type: application/json" \
  -d '{
    "dispute_text": "I never received my package. The vendor stopped responding after I paid."
  }'
```

Expected (with `AI_ENABLED=false`, keyword match on "never received"):
```json
{
  "status": "success",
  "data": {
    "dispute_id": "...",
    "category": "non-delivery",
    "confidence": 0.91,
    "resolution_recommendation": "full-refund",
    "status": "open",
    "expected_resolution_hours": 24
  }
}
```

If confidence >= 0.85 and recommendation is `full-refund`, it auto-resolves and calls Squad Refund API.

Test different dispute categories:

```bash
# Counterfeit
curl -X POST http://localhost:3000/api/escrow/$TX_ID/dispute \
  -H "Content-Type: application/json" \
  -d '{"dispute_text": "The item I received is clearly fake and counterfeit."}'

# Wrong item
curl -X POST http://localhost:3000/api/escrow/$TX_ID/dispute \
  -H "Content-Type: application/json" \
  -d '{"dispute_text": "I received a completely different item than what I ordered."}'
```

---

## Step 13 — Get vendor's transaction list

**Method:** `GET`
**URL:** `http://localhost:3000/api/vendors/me/transactions`

```bash
# All transactions
curl http://localhost:3000/api/vendors/me/transactions \
  -H "Authorization: Bearer $TOKEN"

# Filter by status
curl "http://localhost:3000/api/vendors/me/transactions?status=released&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

Valid status values: `pending`, `funded`, `delivered`, `disputed`, `released`, `refunded`, `expired`

---

## Step 14 — Test B2B API

The B2B API requires an `X-Api-Key` header. The api_key is returned at registration (and is only shown once). For testing, use the demo vendors seeded by `node scripts/seed-demo.js`.

To get a B2B API key, you need to create a B2B partner directly in the database (there is no registration endpoint for partners yet — insert one manually):

```sql
INSERT INTO b2b_partners (id, company_name, contact_email, api_key, tier)
VALUES (gen_random_uuid(), 'Test Partner', 'partner@test.com', crypt('your-test-key', gen_salt('bf')), 'free');
```

Then test:

### Get vendor score (B2B)

```bash
curl http://localhost:3000/v1/vendor/$VENDOR_ID/score \
  -H "X-Api-Key: your-test-key"
```

### Get vendor badge SVG

```bash
curl http://localhost:3000/v1/vendor/$VENDOR_ID/badge \
  -H "X-Api-Key: your-test-key"
# Returns an SVG image
```

### List verified vendors

```bash
curl "http://localhost:3000/v1/vendors?category=Fashion&page=1&limit=10" \
  -H "X-Api-Key: your-test-key"

# Filter by badge tier
curl "http://localhost:3000/v1/vendors?badge=Trusted%20Seller" \
  -H "X-Api-Key: your-test-key"

# Filter by location
curl "http://localhost:3000/v1/vendors?location_state=Lagos" \
  -H "X-Api-Key: your-test-key"
```

### B2B create escrow

```bash
curl -X POST http://localhost:3000/v1/escrow/create \
  -H "X-Api-Key: your-test-key" \
  -H "Content-Type: application/json" \
  -d "{
    \"vendor_id\": \"$VENDOR_ID\",
    \"amount\": 25000,
    \"item_description\": \"B2B order via partner platform\",
    \"buyer_phone\": \"+2348011111111\",
    \"buyer_email\": \"b2bbuyer@test.com\"
  }"
```

---

## Step 15 — Webhook Testing with ngrok

### Setup

1. Start ngrok:
```bash
ngrok http 3000
```

2. Copy the `https://xxxx.ngrok-free.app` URL.

3. Set it in your `.env`:
```env
APP_BASE_URL=https://xxxx.ngrok-free.app
```

4. Register the webhook in your Squad sandbox dashboard:
   - Go to `sandbox.squadco.com` → Merchant Settings → API & Webhook
   - Set Webhook URL to: `https://xxxx.ngrok-free.app/api/webhooks/squad`
   - Copy the webhook secret and set `SQUAD_WEBHOOK_SECRET` in your `.env`

5. Restart the server after updating `.env`.

### Test the webhook connection

Send a test webhook directly to your ngrok URL:

```bash
PAYLOAD='{"Event":"charge_successful","TransactionRef":"test-ref-001","Body":{"amount":100000,"transaction_ref":"test-ref-001","gateway_ref":"test-ref-001_1_1","transaction_status":"Success","email":"test@test.com","merchant_id":"TEST","currency":"NGN","transaction_type":"Transfer","merchant_amount":100000}}'

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha512 -hmac "your_webhook_secret_here" | awk '{print $2}')

curl -X POST https://xxxx.ngrok-free.app/api/webhooks/squad \
  -H "Content-Type: application/json" \
  -H "x-squad-signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

Expected: `{"response_code":200,"response_description":"Success"}`

### Full webhook flow with Squad sandbox

1. Create escrow (Step 8) — get the `checkout_url`
2. Visit `checkout_url` in a browser
3. Select "Transfer" payment method on the Squad modal
4. Squad generates a dynamic VA and displays it
5. To complete the test payment: either use Squad's test simulator in the dashboard, or call the simulate endpoint
6. Squad fires a `charge_successful` webhook to your ngrok URL
7. Your server processes it and moves the transaction to `funded`
8. Confirm delivery (Step 11) to release funds

---

## Step 16 — Test Routes Reference

All `/test/*` routes are only available when `NODE_ENV=development`.

| Method | URL | Description |
|---|---|---|
| `POST` | `/test/webhook/simulate-payment` | Fire a fake charge_successful webhook for a pending transaction |
| `POST` | `/test/squad/simulate-payment` | Call Squad sandbox simulate endpoint directly |
| `GET` | `/test/transaction/:id` | Full transaction debug dump |
| `GET` | `/test/vendor/:id` | Full vendor debug dump with score history |
| `POST` | `/test/score/recalculate/:vendor_id` | Force trust score recalculation |
| `GET` | `/test/health/squad` | Check Squad API connectivity |

---

## Step 17 — Demo Vendor Profiles (for hackathon demo)

Seed the three demo vendor profiles:

```bash
node scripts/seed-demo.js
```

This creates:

| Vendor | ID | Trust Score | Tier |
|---|---|---|---|
| Ada Fashion Store | `11111111-1111-1111-1111-111111111111` | 78 | Trusted Seller |
| Chidi Electronics Hub | `22222222-2222-2222-2222-222222222222` | 65 | Trusted Seller |
| Temi Skincare Brand | `33333333-3333-3333-3333-333333333333` | 55 | Basic Verified |

Get Ada's score:
```bash
curl http://localhost:3000/api/vendors/11111111-1111-1111-1111-111111111111/score
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing or expired JWT | Re-register and get a new token |
| `403 Vendor must complete AI verification` | `verification_status` is not `passed` | Complete Steps 3–5, or run `node scripts/seed-demo.js` for pre-verified vendors |
| `401 Invalid webhook signature` | `SQUAD_WEBHOOK_SECRET` mismatch | Ensure the secret in `.env` matches exactly what's in Squad dashboard |
| `422 Payout bank account could not be verified` | Squad rejected the account | Set `SQUAD_SKIP_BANK_VERIFICATION=true` for local testing |
| `502 Failed to create escrow account` | Squad VA API rejected the request | Check `SQUAD_BENEFICIARY_ACCOUNT` is set to a valid GTBank account |
| `404 Route not found` | Wrong URL path | Check method (GET vs POST) and path |
| `Cannot read properties of undefined` | Missing `.env` values | Copy `.env.sample` to `.env` and fill all required values |
| Trust Score not updating | AI or DB issue | Hit `POST /test/score/recalculate/:vendor_id` manually |
| Webhook not received by server | ngrok URL changed | Restart ngrok, update Squad dashboard webhook URL, update `.env` |

---

## Full Flow Summary

```
Step 2  → Register vendor         → GET token + vendor_id
Step 3  → Start verification      → GET session_id
Step 4  → Submit frame            → progress updates
Step 5  → Complete verification   → trust_score = 30 (Basic Verified)
Step 8  → Create escrow           → GET tx_id + confirm_token + checkout_url
Step 9  → Simulate payment        → transaction status: pending → funded
Step 10 → Buyer views escrow      → sees vendor trust score
Step 11 → Confirm delivery        → funds released, trust score updates
            OR
Step 12 → Submit dispute          → NLP classifies, auto-refund if high confidence
```

---

## Squad API Reference (used by Vaulte)

| API | Endpoint | Used For |
|---|---|---|
| Virtual Accounts | `POST /virtual-account` | Escrow container per transaction |
| Account Lookup | `POST /payout/account/lookup` | Verify vendor payout account at registration |
| Initiate Payment | `POST /transaction/initiate` | Generate buyer checkout URL |
| Verify Transaction | `GET /transaction/verify/:ref` | Confirm payment status |
| Fund Transfer | `POST /payout/transfer` | Release escrow to vendor |
| Refund | `POST /transaction/refund` | Return funds on upheld dispute |
| Simulate Payment | `POST /virtual-account/simulate/payment` | Sandbox testing only |

All Squad endpoints use:
- **Sandbox base URL:** `https://sandbox-api-d.squadco.com`
- **Auth:** `Authorization: Bearer <secret_key>`
- **Webhook signature header:** `x-squad-signature` (HMAC-SHA512)
- **Webhook event field:** `Event` (capital E)
- **Payment event name:** `charge_successful`