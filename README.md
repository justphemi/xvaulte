# Vaulte AI Integration — Endpoint Guide for AI/ML Service

This document summarizes all backend endpoints and flows that interact with the AI microservice so you can integrate, implement, or adapt the Python FastAPI service cleanly.

---

## Overview of AI Responsibilities

The AI service is responsible for:

* Liveness detection (anti-spoofing from webcam frames)
* Face comparison (user vs submitted identity)
* Confidence scoring
* Dispute text classification (NLP)

Base URL (provided via env):

```
AI_SERVICE_URL
```

All communication happens via HTTP (REST).

---

# 1. Liveness Verification Flow

## 1.1 Start Verification Session

### Endpoint (Backend)

```
POST /api/vendors/verify/start
```

### Purpose

Initializes a verification session for a vendor.

### Request (from frontend → backend)

Headers:

```
Authorization: Bearer <JWT>
```

Body:

```
{}
```

### Backend → AI अपेक्षित

The backend may call AI to initialize a session (optional design):

```
POST {AI_SERVICE_URL}/liveness/start
```

Response expected from AI:

```
{
  "session_id": "string",
  "instructions": "Turn head left/right or blink"
}
```

---

## 1.2 Submit Frame (Real-time Processing)

### Endpoint (Backend)

```
POST /api/vendors/verify/frame
```

### Purpose

Streams webcam frames to AI for liveness + face processing.

### Request (frontend → backend)

Headers:

```
Authorization: Bearer <JWT>
Content-Type: application/json
```

Body:

```
{
  "session_id": "string",
  "frame": "base64_encoded_image"
}
```

### Backend → AI

```
POST {AI_SERVICE_URL}/liveness/frame
```

Body sent to AI:

```
{
  "session_id": "string",
  "frame": "base64_encoded_image"
}
```

### Expected AI Response

```
{
  "liveness_passed": true,
  "face_detected": true,
  "confidence": 0.92,
  "feedback": "Good lighting"
}
```

### Backend Response (to frontend)

```
{
  "status": "processing",
  "data": {
    "liveness_passed": true,
    "confidence": 0.92,
    "feedback": "Good lighting"
  }
}
```

---

## 1.3 Complete Verification

### Endpoint (Backend)

```
POST /api/vendors/verify/complete
```

### Purpose

Finalizes verification and updates Trust Score.

### Request

```
{
  "session_id": "string"
}
```

### Backend → AI

```
POST {AI_SERVICE_URL}/liveness/complete
```

### Expected AI Response

```
{
  "verified": true,
  "face_match": true,
  "confidence": 0.95,
  "risk_flags": []
}
```

### Backend Behavior

* Updates vendor verification status
* Feeds result into Trust Score engine

---

# 2. Face Comparison (Identity Matching)

This may be combined with liveness or separate depending on implementation.

### AI Endpoint

```
POST {AI_SERVICE_URL}/face/compare
```

### Request

```
{
  "live_image": "base64",
  "id_image": "base64"
}
```

### Response

```
{
  "match": true,
  "similarity_score": 0.93
}
```

---

# 3. Dispute Classification (NLP)

## Endpoint (Backend)

```
POST /api/escrow/:id/dispute
```

### Purpose

Classifies dispute type and severity automatically.

### Request (frontend → backend)

```
{
  "reason": "Vendor delivered wrong item and is unresponsive"
}
```

### Backend → AI

```
POST {AI_SERVICE_URL}/dispute/classify
```

### Request sent to AI

```
{
  "text": "Vendor delivered wrong item and is unresponsive"
}
```

### Expected AI Response

```
{
  "category": "fraud | delay | quality | other",
  "severity": "low | medium | high",
  "confidence": 0.89
}
```

### Backend Behavior

* Stores classification in DB
* Determines escalation path
* May auto-trigger refund for high severity

---

# 4. Trust Score AI Inputs

AI indirectly affects Trust Score via:

* Verification success/failure
* Confidence scores
* Dispute classifications

### Data Passed Into Trust Engine

Example:

```
{
  "liveness_confidence": 0.95,
  "face_match": true,
  "dispute_severity": "low",
  "fraud_flag": false
}
```

---

# 5. Failure Handling Requirements

AI service MUST:

* Respond within ~2–3 seconds for frame processing
* Return structured JSON always
* Never crash on bad input (return safe fallback)

### Backend Fallback Behavior

If AI fails:

```
status = "review"
```

Manual verification required.

---

# 6. Summary of Required AI Endpoints

| Endpoint           | Method | Purpose            |
| ------------------ | ------ | ------------------ |
| /liveness/start    | POST   | Start session      |
| /liveness/frame    | POST   | Process frames     |
| /liveness/complete | POST   | Final decision     |
| /face/compare      | POST   | Face match         |
| /dispute/classify  | POST   | NLP classification |

---

# 7. Key Notes for AI Dev

* All images are Base64 encoded
* Keep responses lightweight (low latency is critical)
* Confidence scores are REQUIRED (used in Trust Score)
* Deterministic JSON structure (no missing fields)
* Designed for real-time UX (especially /frame)

---

This document should be used as the contract between the Node.js backend and the Python AI microservice.
# vibes
# vibes
# vibes
# justvibez
# xvaulte
# xvaulte
# xvaulte
