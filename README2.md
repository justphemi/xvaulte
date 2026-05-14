# Vaulte Backend API

**AI Trust and Verification Infrastructure for African Commerce**

Squad Hackathon 3.0 — Challenge 01: Proof of Life

---

## What Is This

Vaulte is the backend API for a vendor trust and escrow platform built on Squad's payment infrastructure. It handles:

- AI-powered vendor identity verification (liveness + face comparison)
- Dynamic Trust Score calculation from behavioral transaction data
- Squad-powered escrow for every buyer transaction
- Automated fund release on delivery confirmation via Squad Transfer API
- NLP dispute classification and resolution
- B2B REST API for platform partners

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | PostgreSQL (Supabase) |
| Real-time | Socket.io |
| Payments | Squad API (5 endpoints) |
| AI | Python FastAPI microservice (separate repo) |
| SMS | Termii |
| Deployment | Railway |
| Scheduling | node-cron |

---

## Project Structure

```
vaulte-backend/
├── src/
│   ├── config/
│   │   ├── env.js          — Environment variable validation and export
│   │   └── database.js     — PostgreSQL connection pool (Supabase)
│   ├── controllers/
│   │   ├── vendorController.js    — Registration, liveness verification, score
│   │   ├── escrowController.js    — Escrow creation, delivery confirmation, disputes
│   │   ├── webhookController.js   — Squad webhook ingestion and processing
│   │   └── b2bController.js       — B2B Trust API endpoints
│   ├── middleware/
│   │   ├── auth.js          — JWT vendor auth + B2B API key auth
│   │   ├── errorHandler.js  — Centralized error handler + AppError class
│   │   ├── rateLimiter.js   — Rate limiting (default, strict, webhook)
│   │   └── validate.js      — express-validator error collection
│   ├── repositories/
│   │   ├── vendorRepository.js      — All vendor DB queries
│   │   ├── transactionRepository.js — All transaction DB queries
│   │   └── disputeRepository.js     — All dispute DB queries
│   ├── routes/
│   │   ├── vendorRoutes.js   — /api/vendors/*
│   │   ├── escrowRoutes.js   — /api/escrow/*
│   │   ├── webhookRoutes.js  — /api/webhooks/*
│   │   └── b2bRoutes.js      — /v1/* (B2B API, API key auth)
│   ├── services/
│   │   ├── squadService.js      — All 5 Squad API integrations
│   │   ├── aiService.js         — HTTP client to Python AI microservice
│   │   ├── smsService.js        — Termii SMS integration
│   │   └── trustScoreService.js — Trust Score calculation engine
│   ├── utils/
│   │   ├── logger.js    — Winston logger
│   │   ├── response.js  — Standardized API response helpers
│   │   ├── crypto.js    — HMAC, token generation, bcrypt
│   │   └── jwt.js       — JWT sign and verify
│   ├── app.js    — Express app setup, route mounting
│   └── server.js — HTTP server, Socket.io, cron jobs
├── scripts/
│   ├── schema.sql      — Database schema (run in Supabase SQL editor)
│   └── seed-demo.js    — Demo vendor profiles for hackathon demo
├── .env.sample
├── .gitignore
├── package.json
└── railway.toml
```

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/vaulte-backend.git
cd vaulte-backend
npm install
```

### 2. Configure environment variables

```bash
cp .env.sample .env
# Edit .env and fill in all required values
```

Required values to fill in:
- `DATABASE_URL` — from your Supabase project settings
- `SQUAD_SECRET_KEY` — from sandbox.squadco.com Merchant Settings
- `SQUAD_WEBHOOK_SECRET` — set in Squad webhook dashboard
- `AI_SERVICE_URL` — URL of the running Python AI microservice
- `JWT_SECRET` — any random 64+ character string
- `APP_BASE_URL` — this backend's public URL
- `BUYER_PORTAL_URL` — buyer portal frontend URL

### 3. Run the database schema

Open your Supabase project, go to the SQL Editor, paste the contents of `scripts/schema.sql` and run it.

### 4. Seed demo vendor profiles

```bash
node scripts/seed-demo.js
```

This creates Ada, Chidi, and Temi with 30+ days of transaction history.

### 5. Start the server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server starts on port 3000 (or `PORT` in .env).

### 6. Configure Squad webhook

Use ngrok to expose your local server:

```bash
ngrok http 3000
```

Register `https://your-ngrok-url.ngrok.io/api/webhooks/squad` as your Squad webhook URL in sandbox.squadco.com → Webhook Settings.

Test it:

```bash
curl -X POST http://localhost:3000/health
# Expected: { "status": "ok", "service": "vaulte-backend" }
```

---

## API Endpoints

### Vendor Registration and Verification

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/vendors/register` | None | Register vendor, verify payout account via Squad |
| POST | `/api/vendors/verify/start` | JWT | Start AI liveness verification session |
| POST | `/api/vendors/verify/frame` | JWT | Submit webcam frame for real-time AI processing |
| POST | `/api/vendors/verify/complete` | JWT | Finalize verification, update Trust Score |
| GET | `/api/vendors/me/score` | JWT | Get own Trust Score with component breakdown |
| GET | `/api/vendors/me/transactions` | JWT | Get paginated transaction history |
| GET | `/api/vendors/:id/score` | None | Public Trust Score (for buyer-facing display) |
| GET | `/api/vendors/banks` | None | Nigerian bank list from Squad |

### Escrow Lifecycle

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/escrow/create` | JWT | Create escrow + Squad VA + Payment Link |
| GET | `/api/escrow/confirm/:token` | None | Buyer fetches transaction details |
| POST | `/api/escrow/confirm/:token` | None | Buyer confirms delivery, triggers fund release |
| POST | `/api/escrow/:id/dispute` | None | Buyer submits dispute, triggers NLP classifier |

### Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/webhooks/squad` | HMAC | Squad payment events (charge.completed, etc.) |

### B2B API (API Key Required: `X-Api-Key` header)

| Method | Path | Description |
|---|---|---|
| GET | `/v1/vendor/:id/score` | Trust Score and badge data |
| GET | `/v1/vendor/:id/badge` | Embeddable SVG badge |
| POST | `/v1/escrow/create` | Create escrow on behalf of platform transaction |
| POST | `/v1/escrow/:id/release` | Trigger fund release via confirmation token |
| POST | `/v1/escrow/:id/dispute` | Submit buyer dispute |
| GET | `/v1/vendors` | Filterable directory of verified vendors |

---

## Example Requests

### Register a vendor

```bash
curl -X POST http://localhost:3000/api/vendors/register \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Ada Fashion Store",
    "category": "Fashion",
    "phone": "+2348012345678",
    "nin": "12345678901",
    "payout_account_number": "0123456789",
    "payout_bank_code": "058",
    "location_state": "Lagos"
  }'
```

### Create escrow (after login)

```bash
curl -X POST http://localhost:3000/api/escrow/create \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 35000,
    "item_description": "Custom Ankara dress",
    "buyer_phone": "+2348099999999"
  }'
```

### B2B: Get vendor Trust Score

```bash
curl http://localhost:3000/v1/vendor/11111111-1111-1111-1111-111111111111/score \
  -H "X-Api-Key: your_b2b_api_key"
```

---

## Squad API Integration

All five Squad APIs are used as load-bearing infrastructure:

| API | Where Used | What Breaks Without It |
|---|---|---|
| Virtual Accounts | Escrow container creation | Cannot hold buyer funds |
| Webhooks | Payment confirmation + behavioral AI trigger | Trust Score cannot update; AI cannot score |
| Transfer API | Delivery confirmed fund release + auto-release | Escrow never resolves |
| Payment Links | Buyer checkout URL generation | Buyers cannot pay |
| Refund API | Upheld dispute refunds | Dispute resolution fails |

---

## Deployment (Railway)

### 1. Push to GitHub

Ensure your repo has `/backend` as the root or configure Railway to point to the folder.

### 2. Create Railway project

```
railway login
railway init
railway up
```

### 3. Set environment variables in Railway dashboard

Copy all values from your `.env` into Railway → Variables.

### 4. Verify deployment

```bash
curl https://your-service.up.railway.app/health
```

### 5. Register production webhook URL

Update Squad webhook settings to `https://your-service.up.railway.app/api/webhooks/squad`.

---

## Debugging Common Issues

**Database connection fails on start**
- Check `DATABASE_URL` is correct in `.env`
- Ensure Supabase project is active (free tier pauses after inactivity)

**Squad webhook HMAC validation fails**
- Ensure `SQUAD_WEBHOOK_SECRET` matches exactly what is set in Squad dashboard
- Confirm the raw body is being captured before JSON parsing (handled in `app.js`)

**AI service returns errors**
- Confirm Python FastAPI microservice is running at `AI_SERVICE_URL`
- Backend has a fallback: verifications go to `review` status if AI is unavailable

**Trust Score does not update after payment**
- Confirm Squad webhook is registered and receiving events
- Check server logs for `Squad webhook received` log lines

---

## How Frontend Connects

The vendor dashboard (React) connects via:
- REST API for all data fetching and mutations
- Socket.io for real-time Trust Score updates after each transaction

Connect Socket.io in the vendor dashboard:

```javascript
import { io } from 'socket.io-client';
const socket = io(BACKEND_URL);
socket.emit('join_vendor_room', vendorId);
socket.on('trust_score_updated', (data) => {
  setTrustScore(data.trust_score);
});
```

The buyer portal connects via plain REST — no authentication required, just the confirmation token from the SMS link.

---

Built for Squad Hackathon 3.0 — Challenge 01: Proof of Life