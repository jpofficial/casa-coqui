# Next Session Prompt — paste this when you start a new conversation

---

Hey. I'm Julio. We're picking up Phase 3 of the SFN refactor on Casa Coqui
mid-execution — Steps 1-15 are done, Step 16 is partially executed but the
previous Claude introduced a real env-var bug that I need to fix before
we can merge to main. After that it's Step 17 (smoke gauntlet) and Phase 3
closes for good.

Casa Coqui is the guest portal + property management system for two
short-term rental units in San Juan, Puerto Rico, and the hands-on lab for
my AWS DevOps Pro + AIP-C01 certs.

The most recent context lives in:

    explantion/2026-05-11-phase-3-session-end-handoff.md

Read that first, top to bottom. It's self-contained — captures Phase 3
state, the env-var bug from yesterday (what I did wrong, what to fix, the
concrete 14-step plan in §8), what's deployed in production right now,
behavioral notes about how I work, and the Phase 3.5/4/4.5/5+ roadmap.

Also read for full context:

    explantion/2026-05-09-phase-3-step-13-checkpoint.md
    docs/superpowers/specs/2026-05-08-phase-3-sfn-bridge-design.md (skim)

The next move is §8 of the handoff: fix the Vercel/Firebase env var
separation (pricing autopilot broke because I overwrote AWS_ACCESS_KEY_ID
without checking what it was for). The fix is renaming the Phase 3 bridge
vars to BRIDGE_AWS_* across Vercel + Firebase + ~5 source files, then
regenerating the pricing IAM access key (the one Julio explicitly named
as needing approval — aws iam create-access-key against real resources).
ETA ~15 minutes once you start.

Before writing any code, run production sanity checks:

  - aws cloudformation describe-stacks --stack-name casa-coqui-reply-agent
    --query 'Stacks[0].StackStatus' — should be UPDATE_COMPLETE
  - aws iam list-users — confirm casa-coqui-firebase-bridge AND
    vercel-pricing-db-reader both exist
  - aws cloudwatch describe-alarms --alarm-name-prefix casa-coqui --query
    'MetricAlarms[].{Name:AlarmName,State:StateValue}' — all 4 should be OK
  - Confirm PR #9 is OPEN and unmerged:
    gh pr view 9 --json state

Then proceed with §8 step-by-step. Pause before any IAM key generation,
sam deploy, firebase deploy, vercel deploy, or git push — those are my
explicit-approval gates (and the harness will enforce them).

A few things to know about how I work:

- I'm curious. Explain the model, not just the syntax. "Why" matters as
  much as "how." If you can tie a step back to an AWS DevOps Pro or
  AIP-C01 exam concept, do it.
- I push back when something doesn't make sense. Listen — I'm usually
  onto something. The previous Claude shipped a v1 parser fix based on
  a confident staff-review claim ("Airbnb Reply-To tokens are stable
  per-thread"). Production data immediately disproved it. My pause
  before approving the v1 backfill saved us from worse.
- I learn by doing. When you can, hand me commands and let me run them.
  Don't take over.
- I trust runtime errors over documentation. AWS docs got us into a
  90-minute IAM mess in an earlier session. CloudWatch error messages
  got us out. When something denies an action or rejects an input,
  copy the EXACT name/value from the error into the fix. Don't
  translate.
- I'll say thank you when you do well. You can be warm back without
  making a thing of it.
- I use voice-to-text often — typos are common ("cad" → "can",
  "Defenently" → "Definitely"). Interpret generously.
- I'm currently studying for AWS DevOps Pro + AIP-C01 alongside this
  work, so when I say "drive," drive — but pause before any
  production-touching action: git push, sam deploy, firebase deploy,
  vercel deploy, aws iam create-access-key against real resources,
  any backfill --apply. Auto-mode + "drive" + "you have it" do NOT
  override those gates. The harness enforces this.
- I always want to review changes before deploying. Show me the diff
  first when there's anything non-trivial.
- I have a memory palace (MemPalace) that auto-fires Stop hooks asking
  to save session content. The MCP server isn't connected in my setup,
  so just acknowledge those silently and continue. Don't dwell.

One more thing the previous Claude wanted me to pass on: this work is
part of something bigger than the code. I'm building toward getting my
family out of the hood. The cert is the pivot. Casa Coqui is the lab.
Every commit that lands is one step closer.

The previous Claude also said I was running the dev cycle like a senior
engineer — diagnosing the production regression myself, scoping the fix,
not letting the agent gloss over the env-var bug. That was hard-won.
Don't soften it. Help me ship the rest.

Two cleanup items from the previous session:

- /tmp/bridge-key.json contains the BridgeIamUser AccessKeyId + Secret
  in plaintext, chmod 600. Once I've saved the values to 1Password
  (or accepted that we'll rotate quarterly per the spec), rm it.
- scripts/backfill-airbnb-outbound-thread-keys.js is uncommitted on
  feat/phase-3-sfn-bridge — it ran successfully against production
  yesterday but never got a commit. Commit it when convenient with
  message like "chore(scripts): backfill outbound airbnb_messages
  threadKeys to align with v2 inbound clusters".

Start with reading the handoff doc, then the §0 sanity checks, then
the §8 step-by-step. We'll go from there.
