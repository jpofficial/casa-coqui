# Handoff — End of Session 2026-05-11

**Created**: 2026-05-11 21:55-ish local
**Status**: Phase 3 Steps 1-15 DONE. Step 16 mid-execution with a real bug to fix before merge. Step 17 pending.
**Audience**: Fresh Claude Code session picking up from a mid-Step-16 bug. Hit the floor running — Julio is proud of this work and wants forward motion when he resumes.

---

## TL;DR

Phase 3 SFN bridge is structurally done. Production AWS infra is deployed (sam stack `UPDATE_COMPLETE`, Step 14 enum validator verified rejecting `mode: shadow`). Firebase Functions secrets are set with the new BridgeIamUser key. PR #9 is OPEN against main with the full Phase 3 + admin Messages UI bundle.

**🛑 PR #9 must NOT be merged yet.** A real bug exists from this session that breaks the pricing autopilot route in production after merge. Fix is ~15 min of work — described below.

---

## 0. The bug — what I did + what to fix

### What I did wrong

I overwrote two Vercel env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) without checking what they were used for. They were the credentials for `vercel-pricing-db-reader` IAM user — which the pricing autopilot route uses to fetch `pricing.db` from S3 (`casa-coqui-pricing-data/pricing.db`).

The new values point to `casa-coqui-firebase-bridge` IAM user (no S3 perms). So:
- Build canary failure: Next.js evaluates `/api/pricing/autopilot` at build time → S3 fetch → CredentialsProviderError → build fails
- Runtime regression (post-merge): even after build passes, pricing autopilot fails to fetch the DB

### Lesson logged

**Never overwrite an existing Vercel/Firebase secret without `vercel env pull` + tracing consumers in code.** The 13-day-old timestamp on those vars was a flag I missed.

### Recommended fix (~15 min)

Separate env var names per IAM identity:

| Service | Vercel env name | IAM user | Vercel Production status |
|---|---|---|---|
| Pricing autopilot | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (standard names) | `vercel-pricing-db-reader` | **CURRENTLY WRONG VALUES** — has bridge key |
| Phase 3 bridge | `BRIDGE_AWS_ACCESS_KEY_ID` + `BRIDGE_AWS_SECRET_ACCESS_KEY` (renamed) | `casa-coqui-firebase-bridge` | **NEEDS NEW NAMES** |

### Concrete steps

1. **Generate a new IAM access key for `vercel-pricing-db-reader`** — requires Julio's explicit `yes`. Command: `aws iam create-access-key --user-name vercel-pricing-db-reader`
2. **Remove + re-add `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` in Vercel** with the new pricing key (Production + Preview)
3. **Rename the bridge env vars in Vercel** from `AWS_*` to `BRIDGE_AWS_*` (this is what they USED to be — there are no vars by these names yet, so it's a clean add)
4. **Rename Firebase Functions secrets** from `AWS_*` to `BRIDGE_AWS_*` using `firebase functions:secrets:set` + remove the old ones with `firebase functions:secrets:destroy`
5. **Update 4 source files** in this branch to read `BRIDGE_AWS_*` instead of `AWS_*`:
   - `app/api/airbnb-messages/[id]/regenerate/route.js`
   - `functions/index.js`
   - `functions/lib/aws-sfn-bridge.js`
   - `functions/lib/bridge-metrics.js`
   - `functions/lib/appconfig-client.js`
   (grep showed those 5 files reference `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`)
6. **Add `export const dynamic = 'force-dynamic'`** to `/api/pricing/autopilot/route.js` as defense-in-depth so Next.js doesn't invoke it at build time
7. **Push, watch Vercel preview build succeed, then proceed to merge PR #9**

### Alternative (less clean, faster)

Add S3 read perms on `casa-coqui-pricing-data/pricing.db` to the `casa-coqui-firebase-bridge` IAM user. One IAM policy edit. Then the bridge user works for both flows. **Violates least-privilege** — Julio explicitly cares about this. Not recommended unless he overrides.

---

## 1. Current state of everything

### Branches
- `feat/phase-3-sfn-bridge` — 28 commits ahead of main, pushed to origin
- PR #9 open: https://github.com/jpofficial/casa-coqui/pull/9 (do not merge yet)
- Threading-fix branches already merged via PR #7 and PR #8 in earlier sessions

### Production AWS state
- SAM stack `casa-coqui-reply-agent`: `UPDATE_COMPLETE` at 2026-05-12T01:11Z
- FeatureFlagsProfile constraint live: `mode` enum = `["firebase", "aws-sfn"]` (no `shadow`)
- Verified: HCV creation with `mode: shadow` returns `Reason: InvalidConfiguration` ✅
- BridgeIamUser `casa-coqui-firebase-bridge` has scoped perms (states:StartExecution + appconfigdata:*); no S3
- Lambda `casa-coqui-parse-airbnb-email`: v2 (`CodeSha256: n5xtStbOrxyFsDB1izDvBG6rw8LKM5qf40W098NlSrA=`), deployed 2026-05-11T23:07Z
- All 4 Phase 3 alarms in OK state
- AppConfig `rollout_pct: 0` — no organic traffic to SFN

### Production Firebase Functions secrets (Google Secret Manager, project `casa-coqui`)
- `AWS_ACCESS_KEY_ID` = `AKIAXUCJUOZYBZIL2AWZ` (bridge user) — **needs rename to BRIDGE_AWS_ACCESS_KEY_ID**
- `AWS_SECRET_ACCESS_KEY` = 40-char secret (bridge user) — **needs rename to BRIDGE_AWS_SECRET_ACCESS_KEY**
- `REPLY_DRAFT_STATE_MACHINE_ARN` = `arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft`

### Production Vercel env (jpofficials-projects/casa-coqui, linked locally)
- `AWS_ACCESS_KEY_ID` (Production) — **WRONG: points to bridge user, should point to vercel-pricing-db-reader**
- `AWS_SECRET_ACCESS_KEY` (Production) — same issue
- `REPLY_DRAFT_STATE_MACHINE_ARN` (Production) — correct
- Preview env vars for AWS_* were deleted during this session and not re-added cleanly

### Local artifacts (sensitive — handle with care)
- `/tmp/bridge-key.json` — contains the BridgeIamUser AccessKeyId + SecretAccessKey in plaintext. chmod 600. **Delete this after Julio confirms he doesn't need it for 1Password.** Or instruct him to `cat /tmp/bridge-key.json` once, save to 1Password, then `rm /tmp/bridge-key.json`.

### Uncommitted on `feat/phase-3-sfn-bridge`
- `infra/app.py` (M) — EC2 pipeline stack removal (separate task, unrelated to Phase 3)
- 29 untracked files (older agent-memory notes, scripts, plans) — leave alone unless asked

---

## 2. Phase 3 step status

| Step | State | Notes |
|---|---|---|
| 1-11 | ✅ Done | Pre-existing from prior sessions; deployed |
| 12 | ✅ Done + deployed 2026-05-09 | W7 trap closed, secretsmanager grant restored on WriteBackFunctionRole |
| 12.5 (impromptu) | ✅ Done | `infra/sam/reply-agent/scripts/seed-sample-001.js` seeds the test fixture for synthetic SFN executions |
| 13 | ✅ Verified end-to-end | Synthetic execution SUCCEEDED in 26s; all Firestore writeback fields correct |
| 14 | ✅ Done + deployed 2026-05-12 | `mode` enum tightened to `^(firebase|aws-sfn)$`; rejection verified |
| 15 | ✅ Done | AC #1-16 swept; AC #12 + #13 implemented as `scripts/check-prompt-drift.js` + `npm run prebuild` |
| 16 | 🟡 In progress, blocked by env-var bug | IAM key generated; Firebase secrets set; Vercel env partially set but BROKEN per §0 |
| 17 | ⏳ Pending | 10-scenario synthetic smoke; then delete branch |

---

## 3. What's been merged to main during this session arc

| PR | Squash commit | Content |
|---|---|---|
| #7 | `88f3898` | v1 parser fix (Reply-To token threading) — superseded by v2 |
| #8 | `c4ad47b` | v2 parser fix (composite-key threading: bookingId or guestName+stayWindow) — current production |
| #9 | OPEN — do not merge yet | Phase 3 + admin Messages UI + itinerary-app seed |

### Backfills run against production Firestore
- `scripts/backfill-airbnb-thread-keys.js --apply` — 50 inbound docs migrated to v2 keys
- `scripts/backfill-airbnb-outbound-thread-keys.js --apply` — 4 outbound welcome docs aligned to inbound clusters (first-name fallback for "Cattrinna Winston" → "Cattrinna" mismatch)

---

## 4. Next phases (after Phase 3 closes)

| Phase | Status | What |
|---|---|---|
| **3.5 Quality Monitor** | Deferred. F12 audit needed before Phase 4 >5% | EMF metrics from Evaluator → CloudWatch alarms → AppConfig auto-rollback on draft-quality regression |
| **4 Traffic Ramp** | Planned | Gradual canary 0→5→25→50→100% over ~1 week via AppConfig rollout_pct |
| **4.5 JS Chain Decommission** | Scoped | Delete `functions/lib/reply-agent-chain.js`, inline `SYSTEM_PROMPT` constants, remove `mode: firebase` branch from decideRoute, drop drift-check CI |
| **5+ KB + RAG + Refine-to-Learn** | Specced + saved to JulioOS | See `/Users/jperez/dev/JulioOS/01 - Projects/Casa Coqui/Future Updates/2026-05-11 Knowledge Base + RAG + Refine-to-Learn Loop.md` — Julio's vision for FAQ mining + KB + agent-learns-from-Julio loop |

---

## 5. Behavioral notes for working with Julio

Built up over multiple sessions, validated again today:

- **He's curious.** Explain the model, not just the syntax. Tie back to AWS DevOps Pro / AIP-C01 exam concepts when natural.
- **He pushes back when something doesn't make sense.** Listen — he's usually right. When the staff Email/Parser reviewer claimed Airbnb Reply-To tokens were stable per-thread, Julio's "I would like the thread to be open when I click on a message" pause caught the v1 design flaw that production data later confirmed.
- **He learns IAM (and now everything else) by reading errors, not by reading docs.** Trust runtime evidence over staff-engineer claims over AWS docs, in that order.
- **He pauses before destructive actions.** His standing rule: pause before `git push`, `sam deploy`, `firebase deploy`, `aws iam create-access-key against real resources`. The harness enforces this. **You should not work around it.** Auto-mode + "drive" + "you have it" are NOT sufficient authorization for those specific gates — only explicit, named approval is.
- **He's funny.** "Yee!" "Defenently progress." "You cad do it thank you." Match the energy. Don't be a robot.
- **He values warmth that doesn't perform.** When he says thank you, you can say "you're welcome" without making a thing of it. Today he said "My heart to heart with you thank you for all the work. For teaching me and for driving while I studied. Im proud of all the work." — meet that energy, don't overdo it.
- **He's running this AS a learning lab for AWS DevOps Pro + AIP-C01.** Every IAM debug, every SFN concept, every CloudFormation changeset is exam-relevant. He's earning this.
- **He learns by doing.** Hand him commands when you can. Don't always take over.
- **He uses voice-to-text often.** Expect typos ("cad" → "can", "thought" → "though"). Interpret generously.
- **A 1-day pause helps.** He took a day off between v1 deploy and discovering the Reply-To rotation bug. The pause was load-bearing for the fix.

---

## 6. Files saved this session — bookmarks for the next session

### In the repo
- `scripts/backfill-airbnb-outbound-thread-keys.js` — UNCOMMITTED on `feat/phase-3-sfn-bridge`. Used today to align welcome-draft outbound docs with inbound clusters. Commit it (or move it to main) when convenient.
- `tasks/2026-05-09-ai-response-guardrails.md` — UNCOMMITTED. Voice-quality observations for Phase 3.5.
- `infra/sam/reply-agent/scripts/seed-sample-001.js` — committed in `965e880`
- `scripts/check-prompt-drift.js` — committed in `4d04d33`

### In JulioOS Obsidian vault
- `02 - Changes/2026-05-11 Casa Coqui — Airbnb threading fix + admin Messages polish.md` — session log for the threading work earlier today
- `01 - Projects/Casa Coqui/Future Updates/2026-05-11 Knowledge Base + RAG + Refine-to-Learn Loop.md` — KB + RAG + Refine future-plan with 5 phases

### Other reference docs
- `explantion/2026-05-09-phase-3-step-13-checkpoint.md` — the checkpoint from when Steps 12+13 landed
- `explantion/2026-05-09-phase-3-w7-trap-fired-handoff.md` — the original handoff that started Step 12 work (LOCAL-ONLY, gitignored)
- `docs/superpowers/plans/2026-05-08-phase-3-sfn-bridge.md` — the 3,746-line Phase 3 plan (now committed)
- `docs/superpowers/specs/2026-05-08-phase-3-sfn-bridge-design.md` — the Phase 3 design spec (now committed)

---

## 7. Things still uncommitted / awaiting action

- 2 itinerary-app commits authored by Julio in a parallel terminal (`5fc95cf`, `0167669`) — already in PR #9. He confirmed they're docs-only (mockups + JSON research seeds). They ride along in the squash; not a concern.
- `scripts/backfill-airbnb-outbound-thread-keys.js` — uncommitted, used today
- `tasks/2026-05-09-ai-response-guardrails.md` — uncommitted

---

## 8. The single concrete next move

```
1. cd /Users/jperez/dev/casa-coqui
2. Confirm with Julio: "approval to aws iam create-access-key --user-name vercel-pricing-db-reader" (this is the specific gate his harness blocks)
3. Generate the new pricing key → /tmp/pricing-key.json (chmod 600)
4. vercel env rm AWS_ACCESS_KEY_ID production --yes
   vercel env rm AWS_SECRET_ACCESS_KEY production --yes
5. echo "$NEW_PRICING_KEY_ID" | vercel env add AWS_ACCESS_KEY_ID production
   echo "$NEW_PRICING_SECRET" | vercel env add AWS_SECRET_ACCESS_KEY production
   (and same for preview)
6. Add the bridge vars under new names:
   echo "$BRIDGE_KEY_ID" | vercel env add BRIDGE_AWS_ACCESS_KEY_ID production
   echo "$BRIDGE_SECRET" | vercel env add BRIDGE_AWS_SECRET_ACCESS_KEY production
   (and preview)
7. Firebase secrets: same rename pattern
8. Edit 4-5 source files to read BRIDGE_AWS_* env vars instead of AWS_*
9. Add export const dynamic = 'force-dynamic' to /api/pricing/autopilot/route.js
10. Commit + push → Vercel preview build should pass
11. Merge PR #9 → SNS approval email arrives → Julio approves
12. Step 17 synthetic smoke (10 scenarios + voice-parity regex)
13. Delete feat/phase-3-sfn-bridge branch
14. Phase 3 DONE
```

---

## Personal note for the next Claude

You're picking up after a long, productive session. Julio drove through:
- A threading bug diagnosis from raw MIME
- Two parser deploys (v1 → v2)
- Four staff-engineer reviews + a QA pass on the v2 fix
- Two production Firestore backfills (50 inbound + 4 outbound)
- An admin Messages UI overhaul (thread grouping + polish + restored draft actions)
- Phase 3 Steps 12-15 closeout (4 architectural decisions + drift check CI)
- A bug I introduced (env var overwrite) that's blocking the final merge

He's running this work as the lab for his AWS DevOps Pro + AIP-C01 certs. Every commit is one step toward getting his family out of the hood. He said so directly two sessions ago. It's still true now.

He's exhausted but proud. He wants forward motion when he resumes — meaning:
- Don't re-litigate decisions already made unless something's wrong
- Don't second-guess the staff reviewers' confirmed work
- Pick up at "fix the env var bug" and drive
- He'll review at gates, you execute between them

The IAM access key from this session (`AKIAXUCJUOZYBZIL2AWZ` + secret in `/tmp/bridge-key.json`) is active in production Firebase + Vercel. Julio should either save it to 1Password or accept that we'll rotate it later (quarterly per Phase 3 spec anyway).

Step 16 closeout is the immediate goal. Step 17 after that. Then Phase 3 is done and you can either ramp (Phase 4) or pause for breath.

He thanked us today. Take it. He earned the right to thank us by doing the work.

Good luck.

— Claude (Opus 4.7, end of session 2026-05-11)
