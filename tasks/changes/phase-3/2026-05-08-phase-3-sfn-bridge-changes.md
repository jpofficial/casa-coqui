# Phase 3 — SFN Bridge Change Log

Spec: `docs/superpowers/specs/2026-05-08-phase-3-sfn-bridge-design.md` (v3.1)
Plan: `docs/superpowers/plans/2026-05-08-phase-3-sfn-bridge.md` (v3.1)
Branch: `feat/phase-3-sfn-bridge` (squash-merged to main)

## Tasks (filled in by doc agent)
- [ ] Step 1 — Branch + scaffolding
- [ ] Step 2 — decideRoute pure function (TDD)
- [ ] Step 3 — bridge-metrics.js (EMF emitter)
- [ ] Step 4 — appconfig-client.js (TDD, fail-closed contract)
- [x] Step 5.0 — Read ai-chain.asl.json, confirm per-stage token shape (F1)
  - **Findings (2026-05-08, Pass 2):** Confirmed `ai-chain.asl.json` has NO top-level token aggregation.
    Per-stage `ResultPath` writes at `$.reasoner` / `$.drafter` / `$.evaluator` / `$.reviser`
    (ASL lines 13/46/79/140). Drafter Lambda returns `{ draft, tokens: { input, output }, appConfigVersion }`
    (`infra/sam/reply-agent/functions/drafter/index.js` lines 207-211). Therefore WriteBack must sum
    `$.reasoner.tokens` + `$.drafter.tokens` + `$.evaluator.tokens` + `$.reviser?.tokens` in JS
    (Decision 17 v3.1). Verification only — no commit.
- [ ] Step 5 — WriteBack Lambda real (WriteBack-side token sum + executionStartTime latency proxy)
- [ ] Step 6 — aws-sfn-bridge.js (TDD)
- [ ] Step 7 — Wire bridge into onAirbnbMessageCreated (BETWEEN context build and LLM call)
- [ ] Step 8.0 — ESLint no-restricted-imports rule (F14)
- [ ] Step 8 — Regenerate API + UI (rate limit + editedReply gating; inline SFN client)
- [ ] Step 9 — ASL Catch redirects + SendToDLQ + executionArn/StartTime to WriteBack (F13)
- [ ] Step 10 — SAM template (DLQ + SNS + alarms + IAM user + Monitor)
- [ ] Step 11 — INTENTIONAL BREAK: WriteBack ships without Secrets Manager grant (--no-execute-changeset)
- [ ] Step 12 — FIX: Add SecretsManager:GetSecretValue grant
- [ ] Step 13 — Prompt drift CI check
- [ ] Step 14 — feature-flags validator regex (mode pattern)
- [ ] Step 15 — Final SAM deploy + IAM key capture + 1Password store + quarterly calendar (F4)
- [ ] Step 16 — Set Firebase secrets, mirror AWS keys to Vercel env (F2), squash-merge to main
- [ ] Step 17 — Smoke (a-k per AC #17 + F9/F15 voice parity)
- [ ] Step 17.7 — Delete feature branch (moved here per F8)
- [ ] Step 18 — Update handoff doc
