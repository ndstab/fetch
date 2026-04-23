# Fetch

Agentic shopping with hard spend boundaries.  
User gives a brief, the agent hunts listings, shows top options, user picks one, and Fetch attempts checkout using a quest-scoped virtual card.

## What Problem This Solves

Most shopping assistants fail at one of two things:

- They are "manual copilots" that still require users to do all checkout steps.
- They are "full autopilot" but have weak spending controls and poor transparency.

Fetch is built to sit in the middle:

- It does the heavy work (search, compare, shortlist, checkout automation).
- It preserves user control at the decision point (pick one of the options).
- It constrains money per quest so one task cannot drain an entire wallet.

## Product Model

Each quest is a short-lived economic unit:

- one funded budget envelope
- one checkout session
- one virtual card mint attempt
- one purchase flow
- one settle/refund cycle

This makes money movement auditable per quest and keeps failures isolated.

## How Locus Is Used

Fetch is designed to use multiple Locus primitives end-to-end.

### 1) Checkout With Locus

- Purpose: collect user budget + service fee before starting a quest.
- Flow:
  - backend creates checkout session
  - frontend renders embedded checkout
  - paid event advances quest from `created` to execution

### 2) Wallet / Send APIs

- Purpose: transfer refunds back to payer wallet when quest underspends or fails.
- Notes:
  - refund path can fail due to allowance/policy constraints even if dashboard balance looks healthy
  - backend includes best-effort partial refund fallbacks

### 3) Laso (x402 virtual card path)

- Purpose: mint single-use prepaid card for merchant checkout.
- Important constraints:
  - minimum card amount is $5
  - US egress is required for `laso-get-card` in practice
  - card mint can fail after x402 charge is initiated

### 4) Build With Locus

- Purpose: create per-quest runtime service/container.
- Flow:
  - create project
  - create environment
  - create service from image
  - trigger deployment
  - teardown project after completion (best effort)

### 5) Wrapped APIs

- Purpose: plan/hunt/shortlist pipeline.
- Providers currently wired through backend wrappers:
  - Anthropic (reasoning/ranking)
  - Firecrawl (search/scrape enrichment)

## Architecture (Detailed)

```text
Frontend (React/Vite on Vercel)
  ├─ creates quest
  ├─ hosts embedded Locus checkout
  ├─ streams timeline + options
  └─ sends option pick
        │
        ▼
Orchestrator (Node/Express + Postgres)
  ├─ POST /api/quest/create
  │    └─ creates checkout session
  ├─ POST /webhooks/checkout
  │    └─ marks paid + starts quest execution
  ├─ POST /api/quest/:id/reconcile-payment
  │    └─ webhook fallback path for localhost/non-public webhook cases
  ├─ GET /api/quest/:id/stream (SSE)
  └─ POST /api/quest/:id/pick
       └─ mint card + run checkout + settle/refund
        │
        ├─ Build API (quest container lifecycle)
        ├─ Locus APIs (checkout, send/refund, x402)
        └─ Wrapped APIs (plan/hunt/shortlist)
```

### Quest Lifecycle

1. `created`  
   Quest row exists; waiting for checkout payment.

2. `paid`  
   Payment confirmed by webhook or reconcile fallback.

3. `hunting`  
   Plan/hunt/shortlist pipeline runs; options stored.

4. `awaiting_pick`  
   User selects an option.

5. `buying`  
   Card mint + checkout automation attempt.

6. `complete` or `failed`  
   Settlement/refund + teardown best effort.

## Real-World Constraints and Failure Modes

This section is intentionally explicit because these are the main operational risks.

### A) Laso/x402 Can Charge Before Card Is Usable

Observed failure mode:

- x402 record shows `$5.00` charge to `https://laso.finance/get-card`
- request ends `402` with empty or non-actionable response
- no usable `card_id` returned

Impact:

- user wallet/credits can drop even when card mint fails

Current mitigation in backend:

- pre-mint wallet balance check
- on mint failure, attempt `lasoWithdraw(amount)` recovery
- then execute refund best-effort back to payer

Operational note:

- this is still dependent on upstream allowance/policy state and provider behavior.

### B) Refund Can Fail With 403 Even When Balance Looks Sufficient

Observed failure mode:

- `pay/send` returns policy/allowance rejection or insufficient spendable balance

Why this happens:

- effective transferable amount is not always equal to headline balance
- policy ceilings and allowance windows apply

Current mitigation:

- full refund attempt
- partial refund by allowance when provided
- fallback to partial based on live wallet balance/allowance query

### C) US Egress Requirement for Laso

Observed behavior:

- non-US egress frequently fails Laso mint path

Mitigation:

- run orchestrator from US region
- optionally route through HTTPS proxy with US exit

### D) Webhook Delivery Mismatch in Local/Cloud Mixed Setups

Observed behavior:

- backend may accidentally use `PUBLIC_URL=http://localhost:3001`
- webhook replay fails in Cloud Run

Mitigation:

- set `PUBLIC_URL` to deployed service URL
- reconcile endpoint has fallback to avoid stuck `paid` state

### E) Build Service Image Validation Errors

Observed behavior:

- `imageUri` validation failures from Build API

Mitigation:

- backend now normalizes/validates image URI and falls back to known-good image

## Current Trust Model

- User funds quest budget first.
- Agent does not auto-buy unknown products without a picked option.
- Option cards include reasoning/tradeoff.
- Over-budget options are filtered by tolerance and blocked from direct purchase.
- Budgets below Laso minimum are blocked early.

## Repository Layout

```text
fetch/
├─ frontend/          # React app (landing + quest dashboard)
├─ orchestrator/      # Express backend, DB, Locus integrations
├─ quest-runtime/     # Runtime assets/scripts for quest execution path
├─ docs/              # product + integration notes
├─ CLAUDE.md          # internal project brief / operating notes
└─ instruct.md        # original product spec
```

## Environment Notes

Minimum important backend env vars:

- `LOCUS_MODE=real`
- `LOCUS_API_KEY=...`
- `LOCUS_API_BASE=https://beta-api.paywithlocus.com/api`
- `LOCUS_BUILD_API_BASE=https://beta-api.buildwithlocus.com/v1`
- `DATABASE_URL=...`
- `FRONTEND_URL=...`
- `PUBLIC_URL=https://<your-cloud-run-url>`
- `QUEST_IMAGE_URI=nginxinc/nginx-unprivileged:stable-alpine` (or your runtime image)

Optional but important for Laso reliability:

- `HTTPS_PROXY=...` (US egress proxy)
- `NO_PROXY=localhost,127.0.0.1`

## Running and Deployment

This repo currently uses direct `gcloud run deploy` flows for backend in practice.  
If you are using scripts, keep env values aligned with Cloud Run service settings to avoid regressions.

## Demo Reality (Important)

Because upstream Laso/x402 behavior can be inconsistent and credits may not be reliably recoverable in all failure paths, treat live demos as:

- "best-effort real payment flow with transparent failure reporting"
- not guaranteed success on every run

Recommended demo strategy:

1. keep one known-good merchant/query combination
2. run in US egress
3. preflight wallet/allowance state
4. keep a recorded fallback run
5. show failure-mode handling explicitly when live run fails

This is still useful for judges and users because it demonstrates honest systems engineering around real payment rails, not a happy-path-only mock.

