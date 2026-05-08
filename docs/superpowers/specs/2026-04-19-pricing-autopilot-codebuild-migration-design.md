# Pricing Autopilot — Mac mini → CodeBuild Migration Design

**Status:** Ready for review
**Date:** 2026-04-19
**Authors:** Julio + Claude (Opus 4.7, in-repo)
**Supersedes:** retires `tools/pricing/com.casacoqui.autopilot.plist` (launchd). See §9 cutover.
**Related:** [`tools/pricing/TECHNICAL-PAPER.md`](../../../tools/pricing/TECHNICAL-PAPER.md) — authoritative on the decision engine, TCPN math, and v13/v14 data model. This spec does not re-litigate any of it.

---

## 1. Problem

### 1.1 Why the autopilot exists (business purpose)

Casa Coqui is a two-unit short-stay rental in Las Lomas, San Juan. Revenue is the product of **nightly rate × occupancy**. Holding either constant while the other slides is lost income. The pricing autopilot's job is to **keep both units booked at the best sustainable rate** by moving price in response to market demand — *down* on soft-demand nights to fill empty spots, *up* on tight-demand nights to capture the upside.

This is not a competitor-matching tool. The decision engine at [`tools/pricing/lib/decision-engine.js`](../../../tools/pricing/lib/decision-engine.js) explicitly uses a market-availability signal alongside competitor-price percentile rank. The mapping, paraphrased from `applyDecisionMatrix()`:

| My percentile vs market | Market availability signal | Action | Occupancy logic |
|---|---|---|---|
| Low (P≤55) | tight + strengthening | **raise** | Market filling fast; being underpriced leaves money on the table without improving fill odds |
| Mid (P55–70) | open + softening | **lower** | Slow market; drop price to fill the spot before it goes vacant |
| High (P70–85) | open | **lower** | Above-market in a soft market → won't book at all |
| High (P70–85) | tight | **hold** | High price is defensible when everyone else is full |

Availability is classified from scraped competitor calendars at [`tools/pricing/lib/availability.js`](../../../tools/pricing/lib/availability.js): ≥55% of tracked comps unavailable = `tight`, <30% = `open`. `my_rates.is_booked` feeds back into the decision so recommendations don't fight bookings already on the calendar. Holiday multipliers and seasonal adjustments layer on top.

**The fill-rate signal only works if the data is fresh.** A missed or stale run means the engine is classifying market conditions from days-old snapshots. On a soft-demand weekend, a stale signal recommends "hold" when the right answer was "lower" — and the night goes vacant.

### 1.2 Why the current runtime blocks that purpose

The autopilot runs today on Julio's personal Mac mini under launchd (`com.casacoqui.autopilot.plist`), firing twice weekly (Mon 06:00 + Thu 18:00 local). It scrapes Airbnb with Playwright, runs the decision engine, and writes recommendations to a local SQLite file at `tools/pricing/pricing.db`.

Concrete failure modes this setup produces — each one translates directly into missed-fill risk:

1. **Single point of failure.** Mac mini reboot, wake-from-sleep failure, or `/usr/local/bin/node` PATH drift silently skips a run. No alerting. The dashboard keeps showing the last successful run's recommendations as if they were fresh. A soft-demand weekend can slip by without the engine ever seeing the signal.
2. **No observability.** Build logs go to `tools/pricing/logs/autopilot.log` on local disk. If the Mac mini isn't online when Julio wants to debug a run, the logs aren't reachable.
3. **No portability.** The pricing dashboard at `/admin/pricing` runs on the EC2 production instance. Today that instance can only read the SQLite file if it's physically on the same host. Production dashboard state is a lagging copy of Julio's laptop.
4. **No cost tracking.** Browser automation cost is hidden inside the Mac mini's electricity bill. AWS cost attribution is a design goal for the certification study path and a prerequisite for future scale-out (daily cadence, faster reaction to demand shifts, etc.).

The scraper, decision engine, dashboard, and advisor chat already exist and work (see §3). This spec is narrowly about **where the autopilot executes** and **how its output reaches EC2** — so the existing fill-rate logic can actually do its job on a reliable cadence.

## 2. Goals

**Primary (business):** Make the existing fill-rate / occupancy-aware pricing logic actually reach the dashboard on schedule, so price moves down on soft-demand nights and up on tight-demand nights *while there's still time to affect bookings*. Reliability of the scheduler is the lever — the logic itself (§1.1) doesn't change.

**Secondary (technical):**

- Run the pricing autopilot pipeline (scrape → analyze → archive) in AWS CodeBuild on a fixed schedule, replacing the launchd trigger on the Mac mini.
- Publish the resulting `pricing.db` to S3 as the single source of truth for the admin dashboard.
- Sync `pricing.db` from S3 to the EC2 filesystem on a short cadence so the Next.js API routes at `/api/pricing/*` read fresh data without code changes.
- Alert Julio when a scheduled run fails or is skipped — a silent miss is the failure mode that most directly hurts occupancy.
- Preserve the existing decision engine, admin dashboard, API routes, and advisor chat — no behavioral changes to the reader side.

## 3. Non-goals

- No changes to `tools/pricing/lib/decision-engine.js`, `multi-stay.js`, `comp-timeline.js`, `market-research.js`, `stats.js`, `seasons.js`, `holidays.js`, or the v3–v14 migration files.
- No changes to `app/admin/pricing/page.js` (147KB React dashboard) or the 10 `/api/pricing/*` routes.
- No changes to the advisor chat (`chatWithAdvisor`, `generatePricingAdvice`).
- No migration of the SQLite data model to Firestore, DynamoDB, or RDS. (Evaluated and rejected — see §4.4.)
- No cadence change (stays at Mon 06:00 + Thu 18:00 equivalents; see §5.4).
- No DLQ, per-scrape retry semantics, or Step Functions orchestration. The autopilot's existing purge-before-write pattern and `autopilot_runs` error log cover retries adequately for v1.0.
- No secrets ingest for CodeBuild beyond AWS IAM credentials. The autopilot does not call Anthropic or Firebase; adding them expands the IAM surface for no gain.
- No admin UI to view autopilot runs or trigger manual runs from the dashboard. Existing `/admin/pricing` "Run Autopilot" button (see `app/api/pricing/autopilot/route.js`) remains unchanged — it runs locally, not against CodeBuild. Remote-trigger is tracked as P2 follow-up (§11).
- No `NodejsFunction` bundling, custom AMIs, or Chromium-in-layer optimizations. CodeBuild installs Playwright fresh per run. At twice-weekly cadence the cold-install cost is negligible.

## 4. Architecture decision — Option A (S3 snapshot)

### 4.1 Shape

CodeBuild runs the full autopilot pipeline in an ephemeral build environment. S3 is the durable store for `pricing.db`. EC2 pulls the file on a short cadence and PM2-restarts the Next.js process on change.

```
 EventBridge Scheduler (Mon 10:00 UTC, Thu 22:00 UTC)
     │
     ▼
 CodeBuild: casa-coqui-pricing-autopilot
     │   1. aws s3 cp s3://bucket/pricing.db ./tools/pricing/pricing.db  (if exists)
     │   2. npm ci (root) — installs better-sqlite3 + playwright
     │   3. npx playwright install chromium
     │   4. node tools/pricing/scripts/autopilot.js
     │   5. better-sqlite3 db.backup() → ./tools/pricing/pricing.db.snapshot
     │   6. artifacts: tools/pricing/pricing.db.snapshot → s3://bucket/pricing.db
     │
     ▼
 S3: casa-coqui-pricing-data/pricing.db   (versioned, KMS-encrypted)
     │
     ▼
 EC2 systemd timer (every 30 min)
     │   aws s3api head-object → compare ETag with local cache
     │   on change: aws s3 cp → pm2 restart casa-coqui
     │
     ▼
 Next.js API routes read tools/pricing/pricing.db via better-sqlite3
 (unchanged: lib/pricing-db.js getDb() still opens the same path)
```

### 4.2 Why this shape

- **Decision engine preserved unchanged.** The 40KB of relational query logic (joins, analytical views, percentile math in `multi-stay.js` and `comp-timeline.js`) assumes SQL. Firestore and DynamoDB are the wrong shape. Keeping SQLite preserves ~6 weeks of decision-engine work.
- **Reader state is a single file.** 1MB today, projected ~50MB after a year. S3 storage cost is rounding-error pennies. Download cost on EC2 is rounding-error pennies.
- **CodeBuild + EventBridge + S3 matches the existing CDK idiom.** Same primitives already used by `CasaCoquiEmailStack`, `CasaCoquiEc2PipelineStack`, `CasaCoquiFoundationStack`. Re-uses the Foundation SNS topic for failure alerts.
- **No code changes to the dashboard.** `lib/pricing-db.js` still opens `tools/pricing/pricing.db` on EC2. It doesn't care how that file got there.
- **DOP-C02 exam alignment.** EventBridge Scheduler + CodeBuild project + S3 artifact + CloudWatch alarm + SNS is the canonical event-driven batch pattern. Cert-relevant.

### 4.3 Atomicity

Two risks the design must handle:

- **Concurrent readers on EC2 during `aws s3 cp`.** A partial overwrite of the live `pricing.db` while Next.js has an open handle can corrupt in-flight reads. Mitigation: download to `pricing.db.incoming`, `mv --atomic` to `pricing.db`, then `pm2 restart casa-coqui`. The rename is atomic at the filesystem level; Next.js loses its old handle on restart and reopens cleanly.
- **WAL consistency when CodeBuild uploads.** `autopilot.js` leaves `pricing.db-wal` and `pricing.db-shm` alongside `pricing.db`. Uploading the three files independently can produce an inconsistent state if CodeBuild is interrupted mid-upload. Mitigation: use `better-sqlite3`'s `db.backup(destination)` API to produce a single consistent snapshot file, then upload only the snapshot. `db.backup()` internally checkpoints the WAL.

### 4.4 Options considered and rejected

- **Option B (Firestore migration):** Would require rewriting `decision-engine.js`, `multi-stay.js`, `comp-timeline.js`, the 10 `/api/pricing/*` routes, and significant parts of `app/admin/pricing/page.js`. Firestore's read model doesn't fit percentile and timeline queries that the dashboard issues; moving them would need Aggregation Queries + denormalized materialized views. Dev cost: weeks. Infra savings: pennies. Rejected.
- **Option C (split scrape/ingest):** CodeBuild runs scrape only, emits JSON observations to S3, a Lambda ingests into a remote SQLite on EC2. Adds a third moving part (Lambda) for ~$0.50/mo infra savings vs Option A. Rejected as over-engineered for twice-weekly cadence.

### 4.5 Retained for comparison: the Mac mini loop still works

This migration does not delete `com.casacoqui.autopilot.plist` from the repo. The `.plist` becomes a documented fallback: if CodeBuild is misconfigured or quota-throttled, Julio can `launchctl load` the plist on the Mac mini and resume local execution. The launchd schedule fires against the same `pricing.db` path, so S3 sync stays aligned as long as only one runner is active at a time. Concurrent execution is prevented operationally (see §9 cutover), not structurally.

## 5. Scope of change

| File | Change |
|---|---|
| `buildspec-pricing.yml` | New. CodeBuild buildspec for the autopilot project. |
| `tools/pricing/scripts/autopilot.js` | Surgical: add `--s3-sync` flag that calls `db.backup()` to `pricing.db.snapshot` after the run. |
| `infra/stacks/pricing_stack.py` | New. `CasaCoquiPricingStack` — CodeBuild project, S3 bucket, EventBridge Scheduler, alarm, log group. |
| `infra/app.py` | New stack instantiation. |
| `infra/stacks/hosting_stack.py` | Add EC2 instance-role policy: `s3:GetObject`, `s3:ListBucket` on the pricing bucket. |
| `scripts/ec2/sync-pricing-db.sh` | New. Poll S3 via `head-object`, `cp` + `mv` on ETag change, `pm2 restart`. |
| `scripts/codedeploy/after_install.sh` | Add: install systemd unit + timer pointing at `sync-pricing-db.sh`. |
| `scripts/ec2/casa-coqui-pricing-sync.service` | New. systemd unit. |
| `scripts/ec2/casa-coqui-pricing-sync.timer` | New. systemd timer, `OnCalendar=*:0/30`. |
| `tools/pricing/com.casacoqui.autopilot.plist` | Docstring addition marking as fallback-only. File retained. |
| `SECRETS.md` | Document `ANTHROPIC_API_KEY` is **not** needed by CodeBuild pricing (scoping clarification). |

## 6. Storage layout

### 6.1 S3 bucket `casa-coqui-pricing-data`

| Property | Value |
|---|---|
| Region | `us-east-1` |
| Encryption | SSE-KMS with Foundation CMK |
| Versioning | Enabled (recovery of last-known-good) |
| Public access | Blocked |
| Removal policy | `RETAIN` |
| Lifecycle | Non-current versions expire after 30 days |
| Intelligent-Tiering | Not configured (file is 1–50 MB; infrequent-access tier savings are noise) |

### 6.2 Object keys

| Key | Writer | Reader | Notes |
|---|---|---|---|
| `pricing.db` | CodeBuild (via `artifacts` block) | EC2 systemd timer | Canonical snapshot. ETag = SHA-1 hex (single-part uploads). |
| `runs/<date>/autopilot.log` | CodeBuild (via log upload) | Humans (debug) | Full stdout/stderr tee'd from the build. Kept 90 days via lifecycle rule. |
| `runs/<date>/build-report.json` | CodeBuild | Humans (debug) | Summary from autopilot: scrape_ok, scrape_errors, analysis_ok, warnings, runId. |

### 6.3 EC2 local layout

| Path | Owner | Purpose |
|---|---|---|
| `/home/ec2-user/casa-coqui/tools/pricing/pricing.db` | `ec2-user:ec2-user` | Live DB read by Next.js. Replaced atomically. |
| `/home/ec2-user/casa-coqui/tools/pricing/pricing.db.incoming` | `ec2-user:ec2-user` | Download scratch. `mv` target. |
| `/home/ec2-user/casa-coqui/tools/pricing/pricing.db.etag` | `ec2-user:ec2-user` | Cache of last-synced ETag (string, one line). |
| `/etc/systemd/system/casa-coqui-pricing-sync.service` | root | systemd unit (oneshot). |
| `/etc/systemd/system/casa-coqui-pricing-sync.timer` | root | systemd timer. |

## 7. Commits

### Commit 1 — `buildspec-pricing.yml` + autopilot `--s3-sync` flag

**Commit message:**
```
feat(pricing): add CodeBuild buildspec and S3-sync flag for autopilot

Motivation: the pricing autopilot's job is keeping both units booked at
the best sustainable rate — lowering price on soft-demand nights to fill
the spot, raising on tight-demand nights to capture upside. That logic
already exists in tools/pricing/lib/decision-engine.js and works. What
doesn't work is reliability: the Mac mini runner silently misses runs,
and a missed run means the fill-rate signal goes stale right when it
matters. This commit is the first step of moving the runner to AWS so
the signal actually reaches the dashboard on schedule.

Adds buildspec-pricing.yml targeting a standard Node 20 CodeBuild image
(aws/codebuild/amazonlinux-x86_64-standard:5.0). The build pulls the
current pricing.db from S3 (if present), runs the existing
tools/pricing/scripts/autopilot.js, emits a db.backup() snapshot, and
produces an artifact that CodeBuild uploads to S3 on success only.

The autopilot script gains a --s3-sync flag that, after the pipeline
completes, calls better-sqlite3 .backup('./tools/pricing/pricing.db.snapshot').
.backup() checkpoints the WAL and produces a single consistent file
safe to upload as an atomic artifact. On failure the snapshot is not
produced and CodeBuild skips artifact upload, preserving the last-good
pricing.db in S3.

No behavioral change outside --s3-sync. Existing launchd invocation
(without the flag) continues to work as a documented fallback.
```

**New file — `buildspec-pricing.yml`:**

```yaml
version: 0.2

# Casa Coqui — Pricing Autopilot build
#
# Runtime: Node 20.
# Schedule: twice weekly via EventBridge Scheduler (see pricing_stack.py).
# Output: tools/pricing/pricing.db.snapshot → S3 as pricing.db.
#
# This buildspec intentionally sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
# (inverse of the main web-build buildspec-build.yml). The pricing build
# needs Chromium to run the scraper; the web build does not.
#
# No Secrets Manager references. The autopilot does not call Anthropic
# or Firebase — scraping and decision-engine analysis are self-contained
# against the local SQLite file.

env:
  variables:
    NODE_ENV: "production"
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0"
    AUTOPILOT_TRIGGER: "codebuild"
  shell: bash

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - node --version
      - npm --version
      - echo "Installing root dependencies (pricing autopilot only)"
      # --include=dev because playwright is a devDependency at root.
      # The rest of devDeps (eslint, tailwind, postcss) are tiny and not
      # worth a second package manifest to exclude.
      - npm ci --include=dev --no-audit --no-fund --prefer-offline
      - echo "Installing Chromium for Playwright"
      - npx playwright install --with-deps chromium

  pre_build:
    commands:
      - echo "=== pre_build ==="
      - mkdir -p tools/pricing
      # Pull the current pricing.db from S3 if it exists. First run ever
      # will miss (expected — autopilot.js creates a new DB on demand).
      - |
        if aws s3api head-object \
            --bucket "$PRICING_BUCKET" \
            --key pricing.db >/dev/null 2>&1; then
          echo "Downloading existing pricing.db from s3://$PRICING_BUCKET/pricing.db"
          aws s3 cp "s3://$PRICING_BUCKET/pricing.db" tools/pricing/pricing.db
          ls -la tools/pricing/pricing.db
        else
          echo "No existing pricing.db in S3 — first run or reset."
        fi

  build:
    commands:
      - echo "=== build ==="
      - echo "Running autopilot"
      - node tools/pricing/scripts/autopilot.js --s3-sync | tee tools/pricing/autopilot-run.log

  post_build:
    commands:
      - echo "=== post_build ==="
      # db.backup() produced pricing.db.snapshot — verify and move to
      # the artifact output path.
      - |
        if [ ! -f tools/pricing/pricing.db.snapshot ]; then
          echo "FATAL: pricing.db.snapshot missing after autopilot. Check autopilot-run.log."
          exit 1
        fi
      - ls -la tools/pricing/pricing.db.snapshot
      # Upload run log separately — regardless of success state.
      - RUN_DATE=$(date -u +"%Y-%m-%d")
      - |
        aws s3 cp tools/pricing/autopilot-run.log \
          "s3://$PRICING_BUCKET/runs/$RUN_DATE/autopilot.log" \
          --content-type "text/plain"
      # Emit a small JSON summary parsed from the run log.
      - |
        node -e "
        const fs = require('fs');
        const log = fs.readFileSync('tools/pricing/autopilot-run.log', 'utf8');
        const m = (re) => (log.match(re) || [])[1] || null;
        const report = {
          trigger: 'codebuild',
          runDate: '$RUN_DATE',
          scrapeOk: parseInt(m(/Scrape:\s+(\d+) OK/) || '0'),
          scrapeErrors: parseInt(m(/Scrape:.*?(\d+) errors/) || '0'),
          analysisOk: parseInt(m(/Analysis:\s+(\d+) recommendations/) || '0'),
          durationS: parseFloat(m(/Duration:\s+([\d.]+)s/) || '0'),
          runId: m(/Run ID:\s+(\w+)/),
          warnings: (log.match(/- \[\w+\][^\n]*/g) || []),
        };
        fs.writeFileSync('tools/pricing/build-report.json', JSON.stringify(report, null, 2));
        "
      - |
        aws s3 cp tools/pricing/build-report.json \
          "s3://$PRICING_BUCKET/runs/$RUN_DATE/build-report.json" \
          --content-type "application/json"

artifacts:
  base-directory: tools/pricing
  files:
    - pricing.db.snapshot
  name: pricing-db-$(date +%Y-%m-%d)
  # discard-paths: yes so the artifact key in S3 is just "pricing.db".
  # (See pricing_stack.py secondary artifact renaming.)
  discard-paths: yes

cache:
  paths:
    - "node_modules/**/*"
    - "/root/.npm/**/*"
    - "/root/.cache/ms-playwright/**/*"
```

**Edit to `tools/pricing/scripts/autopilot.js`** — add the `--s3-sync` flag handling near the top CLI parsing block (line ~31):

```js
const S3_SYNC = args.includes('--s3-sync');
```

Add at the end of `main()`, after `closeDb()` but before the final `process.exit(0)` (new block):

```js
  // S3 sync — produce a consistent snapshot file via better-sqlite3 backup API.
  // .backup() is safe to call even after closeDb() because it re-opens the
  // file read-only internally. But we call it BEFORE closeDb() to skip the
  // re-open. Moving this above closeDb().
  if (S3_SYNC) {
    const Database = require('better-sqlite3');
    const srcDb = new Database(DB_PATH, { readonly: true });
    const snapshotPath = path.join(path.dirname(DB_PATH), 'pricing.db.snapshot');
    try {
      await srcDb.backup(snapshotPath);
      console.log(`Snapshot written: ${snapshotPath}`);
    } finally {
      srcDb.close();
    }
  }
```

Note: `closeDb()` at line 457 of the original file must move **below** this new block — the snapshot backup opens its own handle, so the main handle can close first, but the order matters for a reader-only re-open to work on the same file. Safe sequencing: main `closeDb()` → new `Database(DB_PATH, { readonly: true })` → `backup()` → close. The edit can simply move the S3-sync block above the existing `closeDb()`.

---

### Commit 2 — `CasaCoquiPricingStack`

**Commit message:**
```
infra(pricing): add CDK stack for autopilot CodeBuild pipeline

Motivation: promote the pricing autopilot from a Mac-mini side runner to
managed AWS infra so runs fire on a reliable schedule and failures page
instead of silently skipping. Silent skips hurt occupancy directly —
stale market signals mean the engine recommends "hold" when "lower to
fill" was the right call, and the night goes vacant.

New CasaCoquiPricingStack (infra/stacks/pricing_stack.py) provisions:

  * S3 bucket casa-coqui-pricing-data (versioned, KMS-encrypted, RETAIN,
    30-day non-current version expiration, 90-day lifecycle on runs/*)
  * CodeBuild project casa-coqui-pricing-autopilot (compute:
    general1.medium, image: amazonlinux-x86_64-standard:5.0, 60-min
    timeout) with buildspec-pricing.yml from source
  * IAM role for CodeBuild: s3:Get/Put on the pricing bucket, logs, KMS
  * CloudWatch log group /aws/codebuild/casa-coqui-pricing-autopilot
    with 3-month retention
  * EventBridge Scheduler group + two schedules (Mon 10:00 UTC,
    Thu 22:00 UTC) targeting StartBuild — matches the existing launchd
    cadence, preserves the fill-rate signal's freshness window
  * CloudWatch alarm on build FAILED state → Foundation SNS topic
    (silent miss is the failure mode that most directly hurts occupancy)
  * CfnOutputs for cross-stack references (hosting stack needs bucket
    name for the EC2 instance role)

Matches the stack idiom of CasaCoquiEmailStack and CasaCoquiEc2PipelineStack.
Lifecycle: rebuildable. Foundation (KMS, SNS) is the only dependency.

Cost estimate: ~$1-3/month.
  - CodeBuild: general1.medium, 15-25 min/run × 8 runs/mo = ~$2-3
  - S3: 1-50 MB storage + ~100 requests/mo = pennies
  - EventBridge Scheduler: free tier
```

**New file — `infra/stacks/pricing_stack.py`** — key sections (full file has CfnOutput boilerplate matching email_stack.py):

```python
"""
CasaCoquiPricingStack — pricing autopilot infrastructure.

Replaces the Mac mini launchd trigger with CodeBuild + EventBridge Scheduler.
Writes pricing.db snapshots to S3; EC2 systemd timer pulls them.

Resources:
  * S3 bucket casa-coqui-pricing-data (versioned, KMS, RETAIN)
  * CodeBuild project casa-coqui-pricing-autopilot
  * IAM role for CodeBuild
  * CloudWatch log group (3-month retention)
  * EventBridge Scheduler schedule group + two schedules
  * CloudWatch alarm on build FAILED → Foundation SNS topic

Cost: ~$1-3/month. Lifecycle: rebuildable.

DOP-C02 exam topics:
  - EventBridge Scheduler vs EventBridge Rules (Scheduler is purpose-built
    for cron-style invocation, 1 target per schedule; Rules are better for
    event-pattern matching, N targets per rule)
  - CodeBuild PipelineProject vs Project (Project = standalone, not
    wired into CodePipeline)
  - S3 bucket versioning for recovery (previous-version recovery when a
    run corrupts pricing.db)
  - CloudWatch alarms sourcing from CodeBuild state-change events
"""
import os

from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_codebuild as codebuild,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cw_actions,
    aws_events as events,
    aws_iam as iam,
    aws_kms as kms,
    aws_logs as logs,
    aws_s3 as s3,
    aws_scheduler as scheduler,
    aws_sns as sns,
)
from constructs import Construct


PRICING_BUCKET_NAME = "casa-coqui-pricing-data"
CODEBUILD_PROJECT_NAME = "casa-coqui-pricing-autopilot"


class CasaCoquiPricingStack(Stack):
    """Pricing autopilot CodeBuild + scheduler + S3 store."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        cmk: kms.IKey,
        notifications_topic: sns.ITopic,
        codestar_connection_arn: str,
        github_owner: str,
        github_repo: str,
        github_branch: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 1. S3 bucket — durable pricing.db store
        # ------------------------------------------------------------------
        self.pricing_bucket = s3.Bucket(
            self,
            "PricingDataBucket",
            bucket_name=PRICING_BUCKET_NAME,
            versioned=True,
            enforce_ssl=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.KMS,
            encryption_key=cmk,
            bucket_key_enabled=True,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="expire-noncurrent-versions",
                    enabled=True,
                    noncurrent_version_expiration=Duration.days(30),
                ),
                s3.LifecycleRule(
                    id="expire-run-logs",
                    enabled=True,
                    prefix="runs/",
                    expiration=Duration.days(90),
                ),
            ],
            removal_policy=RemovalPolicy.RETAIN,
            auto_delete_objects=False,
        )

        # ------------------------------------------------------------------
        # 2. CloudWatch log group for the CodeBuild project
        # ------------------------------------------------------------------
        # Explicit so retention isn't default-infinite (same cost trap as the
        # email Lambda log group).
        log_group = logs.LogGroup(
            self,
            "PricingAutopilotLogGroup",
            log_group_name=f"/aws/codebuild/{CODEBUILD_PROJECT_NAME}",
            retention=logs.RetentionDays.THREE_MONTHS,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ------------------------------------------------------------------
        # 3. IAM role for CodeBuild
        # ------------------------------------------------------------------
        codebuild_role = iam.Role(
            self,
            "PricingAutopilotRole",
            assumed_by=iam.ServicePrincipal("codebuild.amazonaws.com"),
            description=(
                "Casa Coqui pricing autopilot CodeBuild role: "
                "S3 R/W on pricing bucket, CloudWatch logs, KMS decrypt"
            ),
        )

        self.pricing_bucket.grant_read_write(codebuild_role)
        cmk.grant_encrypt_decrypt(codebuild_role)

        codebuild_role.add_to_policy(
            iam.PolicyStatement(
                sid="WriteCodeBuildLogs",
                actions=[
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources=[log_group.log_group_arn],
            )
        )

        # CodeStar connection permissions for GitHub source — read-only.
        codebuild_role.add_to_policy(
            iam.PolicyStatement(
                sid="UseCodeStarConnection",
                actions=["codestar-connections:UseConnection"],
                resources=[codestar_connection_arn],
            )
        )

        # ------------------------------------------------------------------
        # 4. CodeBuild project
        # ------------------------------------------------------------------
        # general1.medium = 7 GB / 4 vCPU. general1.small (3 GB / 2 vCPU)
        # is marginal for Playwright headless Chromium — documented here
        # as an optimization to revisit if cost becomes a concern.
        self.project = codebuild.Project(
            self,
            "PricingAutopilotProject",
            project_name=CODEBUILD_PROJECT_NAME,
            description=(
                "Runs tools/pricing/scripts/autopilot.js on a twice-weekly "
                "schedule. Writes pricing.db snapshot to the pricing bucket."
            ),
            source=codebuild.Source.git_hub(
                owner=github_owner,
                repo=github_repo,
                branch_or_ref=github_branch,
                webhook=False,  # Schedule-triggered only, no on-commit builds.
            ),
            build_spec=codebuild.BuildSpec.from_source_filename(
                "buildspec-pricing.yml"
            ),
            environment=codebuild.BuildEnvironment(
                build_image=codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
                compute_type=codebuild.ComputeType.MEDIUM,
                privileged=False,
                environment_variables={
                    "PRICING_BUCKET": codebuild.BuildEnvironmentVariable(
                        value=self.pricing_bucket.bucket_name,
                    ),
                },
            ),
            role=codebuild_role,
            timeout=Duration.minutes(60),
            concurrent_build_limit=1,
            logging=codebuild.LoggingOptions(
                cloud_watch=codebuild.CloudWatchLoggingOptions(
                    enabled=True,
                    log_group=log_group,
                ),
            ),
            artifacts=codebuild.Artifacts.s3(
                bucket=self.pricing_bucket,
                include_build_id=False,
                name="pricing.db",
                package_zip=False,
                encryption=True,
            ),
        )

        # ------------------------------------------------------------------
        # 5. EventBridge Scheduler — twice weekly triggers
        # ------------------------------------------------------------------
        scheduler_role = iam.Role(
            self,
            "PricingSchedulerRole",
            assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
            description="EventBridge Scheduler role for pricing autopilot",
        )
        scheduler_role.add_to_policy(
            iam.PolicyStatement(
                sid="StartPricingBuild",
                actions=["codebuild:StartBuild"],
                resources=[self.project.project_arn],
            )
        )

        schedule_group = scheduler.CfnScheduleGroup(
            self,
            "PricingScheduleGroup",
            name="casa-coqui-pricing",
        )

        # Mon 06:00 America/Puerto_Rico = Mon 10:00 UTC (AST, no DST in PR)
        scheduler.CfnSchedule(
            self,
            "PricingMondaySchedule",
            name="casa-coqui-pricing-monday",
            group_name=schedule_group.name,
            schedule_expression="cron(0 10 ? * MON *)",
            schedule_expression_timezone="UTC",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(
                mode="OFF",
            ),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=self.project.project_arn,
                role_arn=scheduler_role.role_arn,
            ),
            state="ENABLED",
        )

        # Thu 18:00 America/Puerto_Rico = Thu 22:00 UTC
        scheduler.CfnSchedule(
            self,
            "PricingThursdaySchedule",
            name="casa-coqui-pricing-thursday",
            group_name=schedule_group.name,
            schedule_expression="cron(0 22 ? * THU *)",
            schedule_expression_timezone="UTC",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(
                mode="OFF",
            ),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=self.project.project_arn,
                role_arn=scheduler_role.role_arn,
            ),
            state="ENABLED",
        )

        # ------------------------------------------------------------------
        # 6. CloudWatch alarm on build failure
        # ------------------------------------------------------------------
        # CodeBuild publishes a FailedBuilds metric per project. Alarm
        # fires on any failed build in a 1-hour window.
        failure_alarm = cloudwatch.Alarm(
            self,
            "PricingAutopilotFailureAlarm",
            alarm_name="casa-coqui-pricing-autopilot-failed",
            metric=cloudwatch.Metric(
                namespace="AWS/CodeBuild",
                metric_name="FailedBuilds",
                dimensions_map={"ProjectName": self.project.project_name},
                period=Duration.hours(1),
                statistic="Sum",
            ),
            threshold=1,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
            alarm_description=(
                "Casa Coqui pricing autopilot build failed. "
                "Check CodeBuild history and runs/<date>/autopilot.log in S3."
            ),
        )
        failure_alarm.add_alarm_action(cw_actions.SnsAction(notifications_topic))

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(
            self,
            "PricingBucketName",
            value=self.pricing_bucket.bucket_name,
            description="S3 bucket holding pricing.db snapshots",
            export_name="CasaCoquiPricing-BucketName",
        )
        CfnOutput(
            self,
            "PricingBucketArn",
            value=self.pricing_bucket.bucket_arn,
            description="ARN of the pricing data bucket (needed by hosting stack)",
            export_name="CasaCoquiPricing-BucketArn",
        )
        CfnOutput(
            self,
            "PricingProjectName",
            value=self.project.project_name,
            description="CodeBuild project name",
            export_name="CasaCoquiPricing-ProjectName",
        )
```

**Edit to `infra/app.py`** — instantiate after `hosting`:

```python
from stacks.pricing_stack import CasaCoquiPricingStack

# ... existing stack instantiations ...

pricing = CasaCoquiPricingStack(
    app,
    "CasaCoquiPricingStack",
    env=env,
    cmk=foundation.cmk,
    notifications_topic=foundation.notifications_topic,
    codestar_connection_arn=(
        "arn:aws:codestar-connections:us-east-1:524140443248"
        ":connection/REPLACE_WITH_VALUE_FROM_SSM"
    ),
    github_owner=github_owner,
    github_repo=github_repo,
    github_branch="main",
    description=(
        "Casa Coqui pricing autopilot — CodeBuild + S3 + EventBridge Scheduler. "
        "Lifecycle: rebuildable."
    ),
)
pricing.add_dependency(foundation)

cdk.Tags.of(pricing).add("Lifecycle", "rebuildable")
```

Note on the hardcoded ARN: `infra/app.py` already hardcodes the artifact bucket name + pipeline secret ARN + KMS key ARN in lines 96-101 (same file). The pattern is to resolve context values on first deploy and pin them. For this stack, the CodeStar connection ARN lives in SSM (`/casa-coqui/pipeline/codestar-connection-arn`); the value is resolved at deploy time by looking it up in SSM via CDK's `aws_ssm.StringParameter.value_from_lookup`. The placeholder in the snippet is where the SSM lookup goes.

---

### Commit 3 — EC2 systemd sync timer + hosting stack IAM

**Commit message:**
```
feat(ec2): add pricing.db sync from S3 via systemd timer

Motivation: close the loop between the CodeBuild writer and the Next.js
reader so the admin dashboard at /admin/pricing shows fresh fill-rate
recommendations within 30 min of each autopilot run. Without this sync,
CodeBuild could be producing perfect recommendations into S3 while the
dashboard keeps rendering yesterday's decisions — same occupancy loss
mode, different cause.

EC2 needs to pull pricing.db from s3://casa-coqui-pricing-data whenever
CodeBuild produces a new snapshot. This commit adds:

  1. scripts/ec2/sync-pricing-db.sh — HEAD-then-GET-on-change, atomic
     rename, pm2 restart on change. Idempotent; safe to run every 30 min.
  2. casa-coqui-pricing-sync.service + .timer — systemd unit + 30-min
     OnCalendar trigger.
  3. scripts/codedeploy/after_install.sh — install the systemd files
     into /etc/systemd/system and enable the timer. Service fires once
     immediately so the DB is fresh before PM2 starts serving requests.
  4. infra/stacks/hosting_stack.py — EC2 instance role gets s3:GetObject
     and s3:ListBucket on the pricing bucket (ARN imported from
     CasaCoquiPricing-BucketArn export).

Sync runs as ec2-user. 30-min cadence matches the freshness window
needed for the fill-rate signal to stay actionable — tighter than that
is wasted polling (autopilot fires twice weekly), looser risks a stale
weekend-eve run.
```

**New file — `scripts/ec2/sync-pricing-db.sh`:**

```bash
#!/bin/bash
# Casa Coqui — pricing.db sync from S3 to EC2.
# Run by systemd timer every 30 min. Safe to run manually.

set -euo pipefail

BUCKET="casa-coqui-pricing-data"
KEY="pricing.db"
APP_DIR="/home/ec2-user/casa-coqui"
LOCAL_DB="$APP_DIR/tools/pricing/pricing.db"
INCOMING="$APP_DIR/tools/pricing/pricing.db.incoming"
ETAG_CACHE="$APP_DIR/tools/pricing/pricing.db.etag"
LOG_TAG="pricing-sync"

log() {
  logger -t "$LOG_TAG" "$@"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

# Head-object to get the current ETag without downloading.
REMOTE_ETAG=$(aws s3api head-object \
  --bucket "$BUCKET" \
  --key "$KEY" \
  --query ETag \
  --output text 2>/dev/null || echo "")

if [ -z "$REMOTE_ETAG" ] || [ "$REMOTE_ETAG" = "None" ]; then
  log "No pricing.db in S3 yet — skipping"
  exit 0
fi

LOCAL_ETAG=""
if [ -f "$ETAG_CACHE" ]; then
  LOCAL_ETAG=$(cat "$ETAG_CACHE")
fi

if [ "$REMOTE_ETAG" = "$LOCAL_ETAG" ] && [ -f "$LOCAL_DB" ]; then
  log "No change (ETag $REMOTE_ETAG) — skipping"
  exit 0
fi

log "ETag changed ($LOCAL_ETAG → $REMOTE_ETAG) — syncing"

# Download to incoming, then atomic rename.
aws s3 cp "s3://$BUCKET/$KEY" "$INCOMING" --only-show-errors
mv "$INCOMING" "$LOCAL_DB"
echo "$REMOTE_ETAG" > "$ETAG_CACHE"

log "Downloaded $LOCAL_DB ($(stat -c%s "$LOCAL_DB") bytes)"

# Restart Next.js so lib/pricing-db.js reopens the file. PM2 restart is
# ~2-3 seconds; the ALB health check handles traffic drain.
if command -v pm2 >/dev/null 2>&1; then
  log "Restarting PM2 app casa-coqui"
  pm2 restart casa-coqui --update-env
else
  log "WARNING: pm2 not found in PATH — skipping restart"
fi

log "Sync complete"
```

**New file — `scripts/ec2/casa-coqui-pricing-sync.service`:**

```ini
[Unit]
Description=Casa Coqui pricing.db sync from S3
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=ec2-user
Group=ec2-user
ExecStart=/home/ec2-user/casa-coqui/scripts/ec2/sync-pricing-db.sh
# PATH needs aws CLI + pm2 (installed globally via npm).
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/ec2-user/.npm-global/bin

[Install]
WantedBy=multi-user.target
```

**New file — `scripts/ec2/casa-coqui-pricing-sync.timer`:**

```ini
[Unit]
Description=Run Casa Coqui pricing.db sync every 30 minutes
Requires=casa-coqui-pricing-sync.service

[Timer]
# Every 30 min, starting 5 min after boot (let PM2 warm up first).
OnBootSec=5min
OnUnitActiveSec=30min
Persistent=true
Unit=casa-coqui-pricing-sync.service

[Install]
WantedBy=timers.target
```

**Edit to `scripts/codedeploy/after_install.sh`** — append:

```bash
# Install pricing.db sync service + timer.
sudo cp scripts/ec2/casa-coqui-pricing-sync.service /etc/systemd/system/
sudo cp scripts/ec2/casa-coqui-pricing-sync.timer /etc/systemd/system/
sudo chmod +x scripts/ec2/sync-pricing-db.sh

sudo systemctl daemon-reload
sudo systemctl enable casa-coqui-pricing-sync.timer
sudo systemctl start casa-coqui-pricing-sync.timer

# Fire a sync immediately on deploy so the DB is fresh before PM2 starts.
sudo systemctl start casa-coqui-pricing-sync.service
```

**Edit to `infra/stacks/hosting_stack.py`** — inside the EC2 instance role block, add policy (exact insertion point is after existing S3 artifact read grants):

```python
# Pricing data bucket — read-only access for the sync timer.
# Bucket ARN imported from CasaCoquiPricingStack export to keep the
# cross-stack dependency explicit.
pricing_bucket_arn = cdk.Fn.import_value("CasaCoquiPricing-BucketArn")
self.instance_role.add_to_policy(
    iam.PolicyStatement(
        sid="ReadPricingBucket",
        actions=[
            "s3:GetObject",
            "s3:GetObjectAttributes",
            "s3:ListBucket",
        ],
        resources=[
            pricing_bucket_arn,
            f"{pricing_bucket_arn}/*",
        ],
    )
)
```

Note: the KMS CMK grant on `instance_role` already exists in the hosting stack (for artifact bucket decryption). The same grant covers pricing-bucket objects since they're encrypted with the same CMK.

---

## 8. Rollback

| Commit | Rollback action |
|---|---|
| 1 | Revert the commit. The autopilot script without `--s3-sync` still works; the launchd schedule on the Mac mini continues to operate against the same local `pricing.db`. No data migration. |
| 2 | `cdk destroy CasaCoquiPricingStack`. The `casa-coqui-pricing-data` bucket is RETAIN and will NOT be destroyed automatically — delete it manually via `aws s3 rb --force` only if intentionally tearing down data. The Mac mini launchd resumes as sole writer without conflict. |
| 3 | Revert the commit. On the next CodeDeploy, the systemd units are not re-installed (CodeDeploy doesn't uninstall files it didn't place in this revision). Manual cleanup: `ssh` to EC2, `sudo systemctl disable --now casa-coqui-pricing-sync.timer`, `sudo rm /etc/systemd/system/casa-coqui-pricing-sync.*`, `sudo systemctl daemon-reload`. The Next.js dashboard reads whatever `pricing.db` is already on disk from before. |

Emergency recovery (CodeBuild writes a corrupt `pricing.db`):

1. `aws s3api list-object-versions --bucket casa-coqui-pricing-data --prefix pricing.db` — enumerate versions.
2. `aws s3api copy-object --copy-source casa-coqui-pricing-data/pricing.db?versionId=<prev> --bucket casa-coqui-pricing-data --key pricing.db` — restore previous version.
3. Wait ≤30 min for EC2 timer, or `ssh` and `sudo systemctl start casa-coqui-pricing-sync.service` to force sync now.
4. Investigate CodeBuild logs at `/aws/codebuild/casa-coqui-pricing-autopilot` for the corrupting run.
5. Optional: disable scheduler (`aws scheduler update-schedule --name casa-coqui-pricing-monday --group-name casa-coqui-pricing --state DISABLED`) until root cause is known.

## 9. Pre-merge + cutover checklist

- [ ] **CDK diff review.**
  ```bash
  cd infra && cdk diff CasaCoquiPricingStack CasaCoquiHostingStack
  ```
  Verify the only changes to `CasaCoquiHostingStack` are the new S3 policy statement and nothing about ALB/EC2 that would force instance replacement.

- [ ] **Deploy pricing stack.**
  ```bash
  cdk deploy CasaCoquiPricingStack
  ```

- [ ] **First manual build.**
  ```bash
  aws codebuild start-build --project-name casa-coqui-pricing-autopilot
  ```
  Watch logs in real time:
  ```bash
  aws logs tail /aws/codebuild/casa-coqui-pricing-autopilot --follow
  ```
  Expected duration: 15–25 min. First run is longest (cold npm cache, Chromium download).

- [ ] **Verify S3 object.**
  ```bash
  aws s3api head-object --bucket casa-coqui-pricing-data --key pricing.db
  ```
  Check `ContentLength` is in the 1–2 MB range (too small = empty DB; too large = WAL not checkpointed).

- [ ] **Spot-check the snapshot locally.** Download and open with sqlite3:
  ```bash
  aws s3 cp s3://casa-coqui-pricing-data/pricing.db /tmp/pricing.db
  sqlite3 /tmp/pricing.db "SELECT COUNT(*), MAX(completed_at) FROM autopilot_runs WHERE status='completed';"
  ```
  Expect ≥1 completed run with `completed_at` within the last hour.

- [ ] **Deploy hosting stack update.** Triggers CodeDeploy; `after_install.sh` installs the systemd units.

- [ ] **Verify EC2 sync on first deploy.**
  ```bash
  ssh ec2 "sudo systemctl status casa-coqui-pricing-sync.timer"
  ssh ec2 "sudo journalctl -t pricing-sync -n 20"
  ```
  Expect the immediate on-deploy service run to have logged `Downloaded /home/ec2-user/casa-coqui/tools/pricing/pricing.db`.

- [ ] **End-to-end dashboard check.** Load `https://casa-coqui.cc/admin/pricing`. Latest `autopilot_runs` row shown in the UI should match the CodeBuild run just completed.

- [ ] **Cutover launchd.** On the Mac mini:
  ```bash
  launchctl unload ~/Library/LaunchAgents/com.casacoqui.autopilot.plist
  ```
  From this point, CodeBuild is the sole scheduled writer. The `.plist` file stays on disk as fallback; re-enable with `launchctl load` if CodeBuild is impaired and Julio needs to keep the dashboard fresh.

- [ ] **Wait for first scheduled run.** The next Mon 10:00 UTC or Thu 22:00 UTC triggers automatically. Confirm by checking CodeBuild history + S3 new version.

- [ ] **Confirm failure alarm.** Either wait for a natural failure (unlikely during bake) or force one by manually modifying the buildspec to `exit 1` in a throwaway branch build. Confirm SNS email arrives.

## 10. Test matrix

Manual smoke tests, matching the 2026-04-18 spec convention (no test framework automation).

### Regression

1. **Mac mini launchd still works.** Before cutover, `launchctl kickstart gui/501/com.casacoqui.autopilot` runs the autopilot once. `autopilot_runs` row written to local `pricing.db`. Dashboard shows the run. This baseline must still pass after Commit 1 lands (before Commit 2/3) to confirm the script edit is backward-compatible.
2. **Dashboard unchanged.** After Commit 3 deploys to EC2, `/admin/pricing` renders identically to pre-deploy. Recharts all render. `/api/pricing/runs` returns the same row count it did before.
3. **Advisor chat works.** `/admin/pricing` chat tab sends a question ("What's driving the Friday-Saturday split for Unit A?"). Response arrives. No regressions in `functions/lib/pricing-evidence.js` or `lib/pricing-db.js`.

### Commit 1 (buildspec + `--s3-sync`)

4. **`--s3-sync` produces a snapshot.** Run locally:
   ```bash
   node tools/pricing/scripts/autopilot.js --unit unit-a --skip-scrape --s3-sync
   ```
   Assert `tools/pricing/pricing.db.snapshot` exists and is a valid SQLite file:
   ```bash
   sqlite3 tools/pricing/pricing.db.snapshot "SELECT COUNT(*) FROM autopilot_runs;"
   ```

5. **No snapshot on failure.** Introduce a deliberate error (e.g., corrupt a required env var), run with `--s3-sync`, assert the snapshot file is NOT created (or is from a prior run; the caller is responsible for removing it before invocation). The buildspec `if [ ! -f tools/pricing/pricing.db.snapshot ]` guard catches this.

### Commit 2 (CDK stack)

6. **`cdk synth` produces valid CloudFormation.** No drift vs actual deployed state:
   ```bash
   cd infra && cdk diff CasaCoquiPricingStack
   ```
   Expect "no changes" after initial deploy.

7. **CodeBuild manual invocation succeeds.** See §9 pre-merge checklist.

8. **Concurrent build limit enforced.** Fire two `start-build` calls back-to-back within 1 sec. Second returns `QUEUED` or `FAILED` with concurrent-limit reason; does NOT run simultaneously. Verify in CodeBuild history.

9. **EventBridge Scheduler triggers within flexible window.** Note the next scheduled time. At that time ±1 min, CodeBuild history shows a new run started by the scheduler principal.

10. **Alarm fires on failure.** Manually create a build failure (push a bad-buildspec branch, start build against it), observe CloudWatch alarm state transition to ALARM, observe SNS email arrives. Restore buildspec before merging.

11. **Log group retention is 3 months, not infinite.**
    ```bash
    aws logs describe-log-groups --log-group-name-prefix /aws/codebuild/casa-coqui-pricing-autopilot
    ```
    `retentionInDays: 90`.

### Commit 3 (EC2 sync)

12. **First-deploy immediate sync.** Deploy the branch via CodePipeline. SSH to EC2 during deploy. Within the `after_install.sh` window, `sudo journalctl -t pricing-sync` shows a successful download + PM2 restart BEFORE `ApplicationStart` completes.

13. **Timer-driven sync (no-op case).** 31 min after a sync, check `journalctl`. Expect one log line: `No change (ETag <hash>) — skipping`.

14. **Timer-driven sync (change case).** Manually upload a modified `pricing.db` to S3 (e.g., via CodeBuild manual run). Within 30 min (or force with `sudo systemctl start casa-coqui-pricing-sync.service`), observe download + PM2 restart in `journalctl`.

15. **PM2 restart doesn't drop traffic.** During a timer-driven sync, hit `https://casa-coqui.cc/` repeatedly with `curl -w "%{http_code}\n"`. Expect zero non-200 responses (ALB health check handles drain).

16. **IAM: EC2 cannot write to pricing bucket.**
    ```bash
    ssh ec2 "aws s3 cp /tmp/foo s3://casa-coqui-pricing-data/test"
    ```
    Expect `AccessDenied`.

17. **Atomic rename.** Kill `aws s3 cp` mid-download (simulated network failure) via SIGKILL during a forced sync. Next sync cycle recovers and completes cleanly. Assert `pricing.db` was never in a partial state (hashed size matches previous good or current good, never in-between).

## 11. Out of scope (tracked separately)

| Item | Priority | Notes |
|---|---|---|
| Admin dashboard "Trigger run now" button that calls `codebuild:StartBuild` | P2 | Small API route + button on `/admin/pricing`. Requires broadening the EC2 instance role to include `codebuild:StartBuild`. |
| `pricing-evidence.js` + advisor prompt changes for CodeBuild-run context | P2 | Advisor could mention "last scheduled run X hours ago" — nice-to-have. |
| Cross-region DR for `pricing.db` | P3 | Bucket is RETAIN + versioned. Full DR (replicate to second region) unjustified at current scale. |
| Observability dashboard for autopilot SLOs (run success rate, duration trend) | P2 | CloudWatch dashboard summarizing `FailedBuilds`, `Duration`, `SucceededBuilds` per project. |
| Weekly digest email summarizing autopilot output | P3 | Derived from `build-report.json` in S3. Separate small Lambda. |
| Migration of `tools/pricing/logs/` to S3 (today: local Mac mini logs) | P3 | Obsoleted by runs/\* in S3 once Mac mini retires. |
| Playwright version pinning + regression testing for DOM drift on Airbnb | P1 | Out of scope here — owned by the scraping engine. Add to `tools/pricing/TECHNICAL-PAPER.md` backlog. |

## 12. Open questions

1. **Should the `--s3-sync` flag be the default when `AUTOPILOT_TRIGGER=codebuild`?** Leaning toward explicit flag for clarity; CodeBuild controls it via buildspec so there's no drift risk. Current spec: explicit `--s3-sync` argument. Flag: no action needed.

2. **Should CodeBuild publish run-success metrics to a custom namespace for a dashboard?** Not in v1.0 — the alarm on `AWS/CodeBuild/FailedBuilds` is sufficient for "did it fail?". Pulling richer run-level metrics into CloudWatch is tracked as P2 (§11).

3. **Schedule drift as Julio moves between Miami and PR.** Puerto Rico doesn't observe DST (always AST, UTC-4). Miami does (EST/EDT, UTC-5/-4). Fixed UTC cron times will cause Miami-local scheduled-time drift by 1 hour twice a year. Accepted — the runs are internal infrastructure, not user-facing; no one is waiting on them at 6:00 local.
