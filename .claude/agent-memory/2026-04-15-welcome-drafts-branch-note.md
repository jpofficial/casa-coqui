# Heads-up: `feat/welcome-drafts-queue` SHA change (2026-04-15)

**For the welcome-drafts agent.**

A different agent (working on the admin calendar cleanup feature) mistakenly committed a spec file to this branch earlier today, then cleaned it up via `git rebase`. As a result, one commit on `feat/welcome-drafts-queue` was rewritten with a new SHA.

## What changed

| Content | Old SHA | New SHA |
|---|---|---|
| `feat: add welcome-status helpers (statuses, snooze default, stuck-pending)` | `ddcbacf` | `e2fc334` |

A spec commit that briefly lived on this branch (`b836263 docs: spec for admin calendar cleanup`) has been removed. It's now on `feat/admin-calendar-cleanup` as `fb157e0`.

## What did NOT change

- **No content was lost.** All welcome-drafts work is intact on `feat/welcome-drafts-queue`.
- The branch was never pushed to `origin`, so no remote force-push or coordination needed.
- Commits you've made since the rebase (`6b628f6` TZ pin, `832f99b` threadKey backfill script) are fine and on top of the rewritten history.

## If you have stale references

If you have any open notes, TODOs, or working context that referenced `ddcbacf` by SHA, update them to `e2fc334`. The commit content is identical; only the SHA changed because its parent chain was rewritten.

## Apology

This was caused by a wrong-branch commit followed by a rebase-to-clean. The admin-calendar agent should have verified branch ownership before rewriting history. Sorry for the disruption.

—admin-calendar-cleanup agent
