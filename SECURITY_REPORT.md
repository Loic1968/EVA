# EVA Security Audit Report

**Application:** EVA (Personal AI Digital Twin)  
**Production URL:** https://eva.halisoft.biz  
**Audit Date:** 2026-02-26  
**Scope:** Zero-tolerance code & security audit

---

## Executive Summary

The EVA app is a Node.js + Express backend with a React + Vite frontend, deployed as a single service on Render. Authentication uses JWT stored in localStorage; the backend enforces owner-scoped access on all API routes. Several **critical** and **high** severity issues require immediate remediation. No npm vulnerabilities were found; supply-chain hardening and automated security tests are recommended.

---

## 1. Project Structure & System Map

### 1.1 EVA App Boundaries

```
eva/
├── server/
│   ├── index.js              # Express app, port 5002
│   ├── db.js                 # PostgreSQL (eva schema)
│   ├── evaChat.js            # Claude AI agent
│   ├── middleware/auth.js    # JWT verifyAuth
│   ├── routes/
│   │   ├── auth.js           # signup, login, forgot/reset, webauthn
│   │   ├── eva.js            # main API (chat, documents, drafts, etc.)
│   │   ├── oauth.js          # Gmail OAuth callback (public)
│   │   ├── realtime.js       # OpenAI Realtime token
│   │   └── voice.js          # Whisper STT + TTS
│   ├── services/
│   │   ├── googleOAuth.js, gmailSync.js, gmailSend.js
│   │   ├── calendarSync.js, documentProcessor.js
│   │   ├── websiteCrawler.js  # SSRF surface
│   │   └── (memory, facts, feedback, settings, etc.)
│   └── workers/
│       ├── gmailSyncWorker.js
│       └── notificationWorker.js
├── web/                      # React + Vite (port 3001 dev)
├── migrations/               # 003–009 SQL migrations
├── scripts/run-migrations.js
├── render.yaml
└── .env.example
```

### 1.2 Ports & URLs

| Service          | Port | Prod URL                    |
|------------------|------|-----------------------------|
| API              | 5002 | https://eva.halisoft.biz   |
| Frontend (dev)   | 3001 | localhost:3001             |

### 1.3 Critical Env Vars

| Variable                   | Required | Notes                                   |
|---------------------------|----------|-----------------------------------------|
| DATABASE_URL              | Yes      | Shared with Halisoft                    |
| EVA_JWT_SECRET / JWT_SECRET | Yes   | Default weak in code (see Finding A3)    |
| ANTHROPIC_API_KEY         | Yes      | Chat / document AI                      |
| EVA_GOOGLE_CLIENT_ID/SECRET | Gmail  | OAuth                                   |
| SMTP_USER, SMTP_PASS      | Reset    | Password reset emails                   |

---

## 2. Authentication Mechanism

- **Method:** JWT in `Authorization: Bearer <token>` header
- **Storage:** localStorage + sessionStorage (`eva_token`)
- **Expiry:** EVA_JWT_EXPIRY (default 7d)
- **Bypass:** EVA_SKIP_AUTH=true disables auth (verify not set in prod)
- **Password reset:** Hashed tokens in DB, 1h expiry

---

## 3. Top Findings (Evidence + Fixes)

### A1: Password Reset Token Leaked in API Response (CRITICAL)

**File:** `server/routes/auth.js` lines 161–167

The `forgot-password` endpoint returns `resetUrl` (containing the raw token) in the JSON response. An attacker can POST `{ "email": "victim@example.com" }` and capture the reset token from the response.

**Fix:** Remove `resetUrl` from the response entirely. When SMTP is not configured, log server-side only; never return the token to the client.

```javascript
res.json({
  exists: true,
  emailSent,
  emailError: emailSent ? null : emailError,
  message: emailSent ? 'Email sent' : 'Email not sent',
});
```

---

### A2: OAuth State = ownerId Enables Gmail Hijack (CRITICAL)

**File:** `server/services/googleOAuth.js` lines 34–40

The OAuth `state` parameter is set to `ownerId` directly. An attacker can craft a consent URL with `state=<victim_owner_id>`, trick the victim into authorizing, and the victim's Gmail gets linked to the attacker's EVA account.

**Fix:** Use a random nonce as `state`, store `nonce -> ownerId` server-side (Redis or in-memory, 10 min TTL). In the callback, resolve `state` to `ownerId`; reject if not found.

---

### A3: Weak Default JWT Secret (HIGH)

**File:** `server/routes/auth.js` line 16

If EVA_JWT_SECRET and JWT_SECRET are unset, the app uses `'eva-dev-secret-change-in-prod'`, allowing JWT forgery.

**Fix:** Exit at startup if no secret is configured:

```javascript
if (!JWT_SECRET) {
  throw new Error('EVA_JWT_SECRET or JWT_SECRET must be set. Exiting.');
}
```

---

### X1: Email HTML Sanitization Insufficient (MEDIUM)

**File:** `eva/web/src/pages/Emails.jsx` lines 125–136

A custom regex-based sanitizer is used before rendering email HTML. Regex sanitizers are prone to bypasses (e.g. event handlers in SVG).

**Fix:** Use DOMPurify or similar. Add `npm install dompurify` and replace the custom `safeHtml` with `DOMPurify.sanitize(html, { ALLOWED_TAGS: [...] })`.

---

### S1: SSRF via Redirect in Website Crawler (MEDIUM)

**File:** `server/services/websiteCrawler.js` lines 69–77

`fetch` uses `redirect: 'follow'` but `validateUrl` only checks the initial URL. A malicious site can redirect to `http://169.254.169.254/` (AWS metadata) or internal hosts.

**Fix:** Use `redirect: 'manual'`, follow redirects manually, and call `validateUrl()` on each redirect target. Cap redirect count (e.g. 3).

---

### L1: Reset Token Logged (MEDIUM)

**File:** `server/routes/auth.js` line 126

When SMTP is missing, `console.log('[EVA Auth] Reset link (no SMTP):', resetUrl)` logs the full reset URL including the token.

**Fix:** Do not log the token. Log only that a reset was requested.

---

## 4. Authorization & IDOR Audit

All routes under `eva.js` use `router.use(verifyAuth)` and pass `req.ownerId` into queries. Resource access (conversations, documents, drafts, gmail, settings) is always scoped with `owner_id = $1` or equivalent. **No IDOR vulnerabilities found.**

---

## 5. Input Validation & Injection

- **SQL:** All queries use parameterized placeholders. No injection found.
- **XSS:** See X1 for email HTML.
- **SSRF:** See S1 for crawler.
- **Path traversal:** Filenames sanitized with `replace(/[^a-zA-Z0-9._-]/g, '_')`. Safe.
- **Schema validation:** None (Zod/Joi). Recommended for `/chat`, `/drafts`, `/auth/*`.

---

## 6. Security Headers & CORS

Helmet is used with custom CSP. CORS restricts origins in production. No CSRF tokens (Bearer-token API; acceptable). Verify `frame-ancestors 'self'` for clickjacking.

---

## 7. Dependencies

`npm audit` reports 0 vulnerabilities. Add Dependabot and run gitleaks for secrets scanning (gitleaks not installed during audit).

---

## 8. Patch Plan

### P0 — Immediate

| # | Fix | Effort |
|---|-----|--------|
| 1 | Remove resetUrl from forgot-password response (A1) | S |
| 2 | OAuth: random state + server-side mapping (A2) | M |
| 3 | Require JWT_SECRET at startup (A3) | S |

### P1 — Short Term

| # | Fix | Effort |
|---|-----|--------|
| 4 | Replace custom safeHtml with DOMPurify (X1) | S |
| 5 | Validate redirect targets in crawler (S1) | M |
| 6 | Stop logging reset token (L1) | S |

### P2 — Medium Term

| # | Fix | Effort |
|---|-----|--------|
| 7 | Schema validation (Zod/Joi) for critical routes | M |
| 8 | Log redaction for secrets/PII | M |
| 9 | Dependabot + gitleaks in CI | S |
| 10 | Tests for IDOR, tenant isolation, rate limit, password reset | M |

### PR Grouping

- **PR1:** A1 + A3 + L1 (auth hardening)
- **PR2:** A2 (OAuth state)
- **PR3:** X1 + S1 (XSS + SSRF)
- **PR4:** Tests + CI

---

## 9. UNKNOWN Items

| Item | How to Verify |
|------|----------------|
| Encryption at rest (DB, disk) | Check Render/Postgres docs |
| EVA_SKIP_AUTH in prod | Audit Render env vars |
| Backup/restore | Review ops docs |
| gitleaks | Install and run against repo |

---

## 10. API Route Reference

| Method | Path | Auth | Notes |
|--------|------|------|------|
| GET | /health | No | Health check |
| GET | /api/auth/config | No | RequireAuth flag |
| POST | /api/auth/signup | No | signupLimiter |
| POST | /api/auth/login | No | loginLimiter |
| POST | /api/auth/forgot-password | No | forgotLimiter |
| POST | /api/auth/reset-password | No | forgotLimiter |
| GET | /api/auth/me | No | Bearer token |
| POST | /api/auth/webauthn/* | Yes | Passkey |
| GET | /api/oauth/gmail/callback | No | PUBLIC — Google redirect |
| GET | /api/realtime/token | Yes | OpenAI Realtime |
| GET | /api/voice/status | Yes | — |
| POST | /api/voice/stt | Yes | Whisper |
| POST | /api/voice/tts | Yes | TTS |
| * | /api/* | Yes | All eva routes |

---

*Report generated from code review. Re-verify in staging before production rollout.*
