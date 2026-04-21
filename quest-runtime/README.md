# quest-runtime

One-container-per-quest Python agent. Deployed by the orchestrator into Build-with-Locus; dies after the purchase settles.

**Day-2 status: skeleton.** The orchestrator's in-process simulator
(`orchestrator/src/lib/quest-simulator.js`) currently drives the entire quest
lifecycle for demos. This directory holds the contracts and scaffolding so
the real implementation can drop in without touching the frontend or the
dashboard schema.

## Structure

| File | Purpose |
|---|---|
| `Dockerfile` | linux/arm64 image with Python + Chromium + Playwright |
| `src/main.py` | Entrypoint. Tiny health server on :8080, then runs the phases. |
| `src/timeline.py` | Writes timeline rows back to the orchestrator. |
| `src/phases/plan.py` | Claude plans the hunt. |
| `src/phases/hunt.py` | Brave + Firecrawl collect candidates. |
| `src/phases/shortlist.py` | Claude ranks down to 3 options. |
| `src/phases/checkout.py` | Laso card + Playwright guest-checkout. |
| `src/phases/settle.py` | Refund unspent sub-wallet + teardown. |

## Env (set by the orchestrator via Build-with-Locus variables)

```
QUEST_ID=qst_...
ORCHESTRATOR_URL=https://orchestrator.fetch.app
SUBWALLET_ID=sw_...
LOCUS_API_KEY=claw_...
DATABASE_URL=postgres://...       # optional; falls back to HTTP if unset
```

## Build

```bash
docker build --platform linux/arm64 -t fetch/quest-runtime:latest .
docker push registry.example.com/fetch/quest-runtime:latest
```

## Run locally (for phase development)

```bash
pip install -e .
python -m playwright install chromium
QUEST_ID=qst_test ORCHESTRATOR_URL=http://localhost:3001 python -m src.main
```
