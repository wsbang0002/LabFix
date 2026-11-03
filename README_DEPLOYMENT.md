# LabFix Deployment & Verification Documentation (v1.3.3)

## 1. Project File Integrity Checklist

| File | Path | Status | Role |
| :--- | :--- | :--- | :--- |
| **Frontend Web App** | `index.html` | ✅ Verified | Vanilla JS SPA with `AbortController`, LocalStorage CRUD, Responsive CSS |
| **Serverless Function** | `api/analyze.js` | ✅ Verified | Vercel Function with `@google/genai`, Upstash Rate Limiting, `net.isIP()` guard |
| **Package Manifest** | `package.json` | ✅ Verified | `@google/genai` (^0.1.1) & `@upstash/redis` (^1.34.3) dependencies |
| **Environment Template**| `.env.example` | ✅ Verified | Template for `GEMINI_API_KEY`, `UPSTASH_REDIS_*`, and model configuration |
| **Git Exclusion Rules** | `.gitignore` | ✅ Verified | Restricts `.env`, `.env.local`, and `.vercel` secrets from commits |
| **Test Suite** | `test/verify.test.js` | ✅ Verified | 12 Automated Unit & Integration Tests (Passes 12/12) |

---

## 2. Step-by-Step Vercel Private Deployment Guide

To deploy LabFix in a **cost-protected, restricted testing environment**, follow these steps:

### Step 1: Push Repository to GitHub
Ensure `.env` and `.env.local` are not tracked by Git:
```bash
git add .
git commit -m "LabFix Production Ready v1.3.3"
git push origin main
```

### Step 2: Import Project into Vercel
1. Log into your [Vercel Dashboard](https://vercel.com).
2. Click **Add New...** -> **Project** and import your `labfix` repository.
3. Framework Preset: **Other** (Root directory containing `index.html` and `api/`).

### Step 3: Configure Environment Variables in Vercel
Go to **Settings** -> **Environment Variables** in Vercel and input the following values:

| Key | Example / Recommended Value | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | `AIzaSy...` | Your Google Gemini API Key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model name |
| `UPSTASH_REDIS_REST_URL` | `https://xxxx.upstash.io` | Upstash Redis REST URL for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | `AXxxxx...` | Upstash Redis REST Token |
| `NODE_ENV` | `production` | Enables Fail-Closed security & disables mock mode |
| `ALLOW_MOCK_TEST` | `false` | Explicitly disables mock mode in production |

### Step 4: Configure Cost Protection & Private Deployment Access
To prevent unauthorized usage and unexpected billing:
1. Go to **Settings** -> **Deployment Protection** in Vercel.
2. Enable **Vercel Authentication** or **Password Protection** for Preview/Production deployments.
3. Go to **Settings** -> **Security** -> **Rate Limiting / Attack Challenge Mode** to enable Vercel DDoS protection.

---

## 3. Real Integration Verification Checklist (Post-Deployment)

Execute the following verification steps on your deployed private Vercel URL (e.g., `https://labfix-xxxx.vercel.app`):

### A. Live Gemini AI Analysis Verification
1. **Arduino Upload Error Case:**
   * **Input:** Select **Arduino (Uno R3)** -> Select `1. Arduino 업로드 응답 오류` chip -> Click **[✨ Gemini AI 오류 분석하기]**.
   * **Expected:** HTTP 200 response, `model: "gemini-2.5-flash"`, structured JSON result displaying error type `avrdude sync error` in UI.
2. **Python ModuleNotFoundError Case:**
   * **Input:** Select **Python (3.x)** -> Select `3. Python ModuleNotFoundError` chip -> Click **[✨ Gemini AI 오류 분석하기]**.
   * **Expected:** HTTP 200 response, error type `ModuleNotFoundError`, step-by-step resolution checklist rendered in Korean.

### B. Live Upstash Redis Rate Limiting Verification
1. **Atomic Counter & TTL Test:**
   * Send 5 consecutive requests using the AI analysis button.
   * **6th Request:** UI displays HTTP 429 warning: `요청 빈도가 너무 높습니다. 1분 후 다시 시도해 주세요. (Redis Rate Limit)`.
2. **Fail-Closed Safeguard Test:**
   * Temporarily rename `UPSTASH_REDIS_REST_URL` in Vercel settings -> Save -> Trigger AI Analysis.
   * **Expected:** HTTP 503 response: `공개 운영 환경의 분산 Rate Limiting (Upstash Redis) 설정이 완료되지 않았습니다.`

### C. Browser Frontend Regression Verification
1. **Request Cancellation:** Trigger AI analysis, immediately modify the error log text. Verify `fetch` is aborted via `AbortController`, and the button unlocks instantly.
2. **History CRUD:** Save a record -> Modify resolution status & memo in detail modal -> Delete individual record -> Perform Clear All. Verify data integrity in `localStorage`.
3. **Mobile Responsiveness:** View on 360px / 390px viewport width to ensure no horizontal layout overflow or line clipping occurs.

---

## 4. Final Integration Status Matrix

| Module | Inspection Domain | Status | Execution & Verification Notes |
| :--- | :--- | :--- | :--- |
| **LOCAL TEST** | Automated Backend Test Suite | ✅ **VERIFIED (12/12 Passed)** | `node test/verify.test.js` executed locally (0 failures). |
| **VERCEL DEPLOYMENT** | Project Build & Serverless Routing | ⚠️ **UNVERIFIED (Pending User Deploy)** | Configuration files verified. Requires user push to Vercel. |
| **LIVE GEMINI** | Real Google Gen AI API Invocations | ⚠️ **UNVERIFIED (Pending API Key Binding)** | SDK code & JSON Schema verified. Requires live `GEMINI_API_KEY`. |
| **LIVE REDIS** | Upstash Redis Rate Limiting Cluster | ⚠️ **UNVERIFIED (Pending Redis Binding)** | Atomic Lua script & net.isIP verified. Requires live Upstash token. |
| **BROWSER TEST** | Frontend UI/UX, LocalStorage & Abort | ✅ **VERIFIED (Canvas Environment)** | Tested `AbortController`, responsive UI, and LocalStorage CRUD. |