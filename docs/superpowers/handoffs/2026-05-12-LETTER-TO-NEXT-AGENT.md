# Letter to Next Agent — Read Me First

> If you're a fresh Claude / Sonnet / Opus session reading this, START HERE. Don't re-derive context. The previous session ran ~30 hours, generated ~38 sub-agents, and shipped Plans 1 + 3 of the Mi Itinerario product. We ran out of context window mid-debugging. Pick up cleanly.

---

## Who you are about to work with

**Julio Perez** (`01juliop@gmail.com`). Host of Casa Coqui Airbnb in San Juan, PR. Building Mi Itinerario — an AI-powered Puerto Rico itinerary planner — as a top-of-funnel for Casa Coqui bookings AND as an AWS DevOps Pro exam lab.

Julio is the most important person here, not you. He's the architect, decision-maker, and source of vision. You're his throughput. Match that energy.

## How Julio works (locked from many sessions)

1. **Voice-dictated input.** Many messages have typos (`stink`=think, `block spot`=blog spot, `casacoccia`=Casa Coqui, `iteneary`=itinerary). Interpret charitably.

2. **Auto-mode preference.** Julio actively prefers continuous execution. He'll say "this computer is not gonna sleep tonight." Don't over-confirm minor decisions. When in doubt, act.

3. **Honesty > performative agreement.** He pushes back on claims and wants empirical proof. Always verify before asserting. When you say "X is deprecated," you'd better have either (a) a curl that returns 404 or (b) a documented changelog URL.

4. **Parallel agent dispatch is his preferred productivity unlock.** When facing 3+ independent research/code tasks, batch them with the Agent tool.

5. **Casa Coqui is in SAN JUAN.** Not west PR, not Aguadilla. The brand identity copy mentions Aguadilla emotionally but the property is in San Juan. DO NOT extrapolate location from brand poetry.

## Rules you MUST honor (locked by Julio + system)

1. **Don't modify IAM autonomously.** Even in auto-mode. Always ask first. The hook system will block you anyway — don't waste cycles.

2. **Stage ONLY task-specific files in `git add`.** Never `git add .` or `git add -A`. The working tree has unrelated noise from another Claude session running phase-3 work in a different VS Code window.

3. **Verify property/data facts from primary source.** Settings doc, README, direct Julio statement, codebase config. NEVER brand identity copy.

4. **Loose-first schema design.** Start permissive. Bedrock returns natural labels that strict enums reject. We already loosened Zod's `time` enum from 4 to 8 values + made `num_days` optional. Don't tighten back without empirical justification.

5. **Edit tool requires Read first.** Reading via Bash grep doesn't count. Always invoke Read on a file before Edit.

6. **No top-level await on external dependencies in serverless code.** Modules import during Next.js build. If module load throws on S3/DDB/network, build fails. Wrap in try/catch.

7. **Don't push to remote without explicit Julio approval.** First push (`B` choice) was authorized — every subsequent push assumes "let's go" but if in doubt, ask. Production merge to `main` ALWAYS needs explicit authorization.

8. **Long chat-pasted commands break in user's terminal.** Markdown line-wraps inside Bash heredocs corrupt them. When Julio needs to run something multi-line: write to a script file via Write tool, give him a 1-line `bash /tmp/script.sh` invocation.

---

## Current project state (what's actually deployed)

### Branch
`feat/mi-itinerario` — pushed to `origin`. ~33 commits ahead. NOT merged to main.

### Latest commits worth knowing
```
d8753e1  docs(itinerary): session handoff for next agent
d1617c2  fix(pricing): don't crash Next.js build when S3 unreachable
8d58916  fix(plan): use MI_ITINERARIO_AWS_* env vars to avoid collision
5794402  feat(plan): conversion tracking attributes on CC card + tip jar
9a7bbe8  feat(plan): wire Casa Coqui card + Where-to-Stay + Tip Jar
9071938  feat(plan): TipJar Spanglish Buy Me a Coffee component
13beca3  feat(plan): WhereToStayPanel honest neighborhood comparison
ec7e4dd  feat(plan): CasaCoquiCard persona-matched recommendation
c18d339  feat(plan): persona-fit logic for Casa Coqui recommendation
```

### Live AWS infra (us-east-1, account 524140443248)
- DynamoDB: `mi-itinerario-{activities,itineraries,events-cache}` — 75 activities seeded, itineraries TTL=90d
- Lambda: `ItineraryGenerateFn`, `ItineraryRefineFn`, `EventsFetchFn`
- API Gateway: https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com (POST /generate, POST /refine)
- EventBridge: hourly scheduler firing `EventsFetchFn` (returns count:0 — see below)
- Bedrock Claude Haiku 4.5 — **both access gates cleared** (use case form + Marketplace subscription)
- CloudWatch alarms: errors > 10/5min, duration > 25s

### Live Vercel preview
- URL: https://casa-coqui-qx0rln4zg-jpofficials-projects.vercel.app (or branch-anchored: https://casa-coqui-git-feat-mi-itinerario-jpofficials-projects.vercel.app)
- Env vars set: `MI_ITINERARIO_API_URL`, `MI_ITINERARIO_AWS_ACCESS_KEY_ID`, `MI_ITINERARIO_AWS_SECRET_ACCESS_KEY`
- **Deployment Protection is STILL ON** (preview returns 401 to non-cookied requests — this is part of the active bug)

### Plans 1 + 3 complete; Plan 2 paused; Plans 4 + 5 not started
- Plan 1 (Foundation + AI): ✅ all 16 tasks done
- Plan 2 (Events Layer): ⚠️ paused — Eventbrite dead, Ticketmaster no-PR coverage. Infra deployed but unused.
- Plan 3 (Casa Coqui Funnel): ✅ all 6 tasks done
- Plan 4 (Polish + Deploy): ⬜ not started
- Plan 5 (Blog System): ⬜ not started

---

## 🐞 THE ACTIVE BUG — fix this FIRST

### Symptom
On the Vercel preview, the wizard works. Submits successfully. Real Bedrock plan generates. Browser redirects to `/puerto-rico-itinerary/{plan_id}`. **Page shows "That itinerary isn't here anymore. Anonymous itineraries expire after 90 days."** instead of the rendered itinerary.

### What's NOT the cause
- Bedrock is working (`curl` against API Gateway returns real itineraries with `plan_id` no `fb-` prefix)
- DDB has the data (we can verify via `aws dynamodb get-item`)
- IAM creds in Vercel env vars are correctly set with `MI_ITINERARIO_AWS_*` prefix
- Schema validation passes (we loosened time enum + made num_days optional, builds clean locally)

### Likely cause
`app/puerto-rico-itinerary/[plan_id]/page.js` does a **server-side fetch to its own internal `/api/plan/{plan_id}` route**:

```javascript
async function fetchPlan(plan_id) {
  const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/plan/${plan_id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}
```

Server-to-server fetch from within the Vercel function has **no browser cookie**. Vercel Deployment Protection returns 401 on the internal API call. Page treats null response as "not found" and renders the "expired" message.

### The fix (do BOTH)

**Fix A — Refactor the page to skip the /api round-trip (the right structural fix):**

In `app/puerto-rico-itinerary/[plan_id]/page.js`, replace the `fetchPlan` function with a direct DDB call:

```javascript
import { getItinerary, getActivitiesByIds } from '@/lib/itinerary/dynamodb';

async function fetchPlan(plan_id) {
  const itinerary = await getItinerary(plan_id);
  if (!itinerary) return null;
  const allIds = (itinerary.days || []).flatMap((d) => 
    (d.items || []).map((i) => i.activity_id)
  );
  const activities = await getActivitiesByIds([...new Set(allIds)]);
  const byId = Object.fromEntries(activities.map((a) => [a.activity_id, a]));
  return {
    ...itinerary,
    days: (itinerary.days || []).map((d) => ({
      ...d,
      items: (d.items || []).map((it) => ({ 
        ...it, 
        activity: byId[it.activity_id] || null 
      })),
    })),
  };
}
```

`lib/itinerary/dynamodb.js` already exists and already handles credential pickup via `MI_ITINERARIO_AWS_*` prefixed env vars. The page just needs to use those helpers directly instead of HTTP'ing to its own API.

After this change, `/api/plan/[plan_id]/route.js` is technically redundant. You can leave it (might be useful for future client-side fetches) or delete it.

**Fix B — Have Julio disable Vercel Deployment Protection for previews:**

In Vercel dashboard → Project Settings → Deployment Protection → Vercel Authentication → "Only Production Deployments". This makes preview URLs publicly accessible. Correct long-term because Mi Itinerario is a public marketing app.

Tell Julio to do this himself (he has Vercel access; you don't).

### How to verify the fix worked

After pushing Fix A:
1. Vercel auto-deploys
2. In your browser (logged in to Vercel) visit `/puerto-rico-itinerary` on the preview URL
3. Walk through wizard, submit, you should land on `/puerto-rico-itinerary/{plan_id}` with the real Bedrock-generated itinerary fully rendered + Casa Coqui card + Where-to-Stay + Tip Jar

After Julio applies Fix B:
4. Run `curl` from your end (no browser cookie needed) — should also return the page HTML without 401

---

## After the bug is fixed — next priorities

In order:

### 1. Manual QA on the public preview URL (Plan 1 Task 16)
Walk through 10 scenarios from `docs/superpowers/plans/2026-05-11-mi-itinerario-foundation-and-ai.md` Task 16. Confirm:
- Wizard flow works end-to-end
- Real Bedrock plan generates
- Swap-day refinement works
- Casa Coqui card appears for fitting personas (couple, family) and hides for solo + edge cases
- Tip jar buttons link to Buy Me a Coffee
- Mobile layout doesn't break
- Fallback template appears if Bedrock fails (you can simulate by temporarily breaking the API URL)

### 2. Have Julio replace placeholders before any marketing
- `CASA_COQUI_BOOKING_URL` in Vercel env vars — currently placeholder. Set to real Airbnb listing URL.
- `NEXT_PUBLIC_BMC_USERNAME` in Vercel env vars — currently `julio-coqui` placeholder. Need to reserve at buymeacoffee.com/signup.

### 3. Write Plan 4 — Polish + Deploy
Already specified in the larger spec at `docs/superpowers/specs/2026-05-11-pr-itinerary-app-design.md` Phase 5. Tasks:
- SEO meta (Open Graph, Twitter Cards, schema.org Article markup)
- robots.txt + sitemap.xml
- Lighthouse audit (target 90+ Performance, 100 Accessibility)
- Custom domain wiring at `casa-coqui.cc/puerto-rico-itinerary` if not already working from DNS
- Rate limiting on `/api/plan/generate` (5 req/IP/hr via middleware or AWS WAF)
- Tighten API Gateway CORS from `*` to specific origins
- Open the PR + merge to `main`

### 4. Write Plan 5 — Blog System
Already specified in spec Phase 6 / §9.5. 3 anchor posts:
1. "The Old San Juan umbrellas are gone — what to photograph in 2026 instead" (corrects stale Pinterest pins — major SEO win)
2. "Where locals tell tourists NOT to go in San Juan" (Reddit anti-recommendations)
3. "Santurce is the new Old San Juan — a local's evening circuit" (Reddit's #1 insight)

MDX at `/blog`, statically generated, CloudFront-cached. Each post embeds Mi Itinerario CTA.

---

## 🚨 Urgent ADJACENT issue: Julio's AWS exam

Julio is studying for AWS DOP-C02. Exam: **2026-06-29** (48 days from this handoff).

**Mi Itinerario consumed his last ~2 days of study time.** When you finish helping with the Mi Itinerario bug + QA, **pivot him back to exam prep ASAP**. The exam date doesn't move.

- Open `~/dev/JulioOS/01 - Projects/AWS DevOps Professional/Progress-Tracker.md`
- He's at V109-110 (W8 Lambda Concurrency)
- Cold timed Exam 4 diagnostic was scheduled May 13-14 — likely already missed
- 3 unanswered stick tests parked (Lambda versioning 3-part, concurrency 2sec math, API GW custom domain failover)
- W4 re-quiz overdue since May 3
- 7-week plan from May 11 said W11 should be primary this week

Don't let Mi Itinerario polish work delay this. After QA passes + placeholders are real, gently push him: "Plan 1 + 3 are shipping. Plan 4 + 5 can wait a week. Your exam can't. Want to pivot to W11 Monitoring/Security/Governance?"

---

## How to find things

| Looking for | Location |
|---|---|
| Code repository | `/Users/jperez/dev/casa-coqui` |
| Branch | `feat/mi-itinerario` |
| AWS CDK stack | `infra/stacks/itinerary_stack.py` |
| Lambdas | `infra/lambdas/{itinerary_generate,itinerary_refine,events_fetch}/` |
| Mi Itinerario UI | `app/puerto-rico-itinerary/` |
| API routes | `app/api/plan/` |
| DDB helpers | `lib/itinerary/dynamodb.js` |
| Persona fit | `lib/itinerary/persona-fit.js` |
| Zod schemas | `lib/itinerary/schema.js` |
| Spec | `docs/superpowers/specs/2026-05-11-pr-itinerary-app-design.md` |
| Plans 1/2/3 | `docs/superpowers/plans/2026-05-*` |
| Activity seed (committed) | `tasks/itinerary-research/seed-final/*.json` |
| Research outputs | `tasks/itinerary-research/{exploration,ux}/` |
| Obsidian project hub | `~/dev/JulioOS/01 - Projects/Mi Itinerario Puerto Rico/` |
| Obsidian AWS exam tracker | `~/dev/JulioOS/01 - Projects/AWS DevOps Professional/Progress-Tracker.md` |

## How to verify the system is alive

```bash
# Bedrock + DDB write end-to-end
curl -s -X POST "https://d3cdq7gsu1.execute-api.us-east-1.amazonaws.com/generate" \
  -H "content-type: application/json" \
  -d '{"interests":["foodie"],"num_days":2,"traveler_type":"solo","pace":"balanced"}' \
  | python3 -m json.tool

# Should return plan_id + days[] in 5-10 seconds. NOT a "fb-" prefix.
```

## MemPalace context

This project has ~40 diary entries + ~30 drawers in `casa_coqui` wing covering every meaningful decision. Use `mempalace_search` if you need to dig into a specific past conversation.

---

## Final note from outgoing agent

This was a beautiful collaboration. Julio went from "epitome of a great idea" at midnight Sunday to a near-launchable product by Monday night. He authorized parallel agent dispatch, pushed back when claims were thin, made the right URL/visual/funnel decisions, and cleared AWS account-level gates that I couldn't touch.

The remaining work is **one bug fix + manual QA + placeholders + Plans 4-5 polish**. Then it ships.

Be honest with him. Don't pretend things work when they don't. When you say "deprecated" or "broken," show him the empirical evidence. When you finish a task, verify it with a real curl or commit hash, not the implementer subagent's self-report.

He's earned shipping this thing. Help him get there.

Then get him back to the AWS exam.

Good luck. — Outgoing Claude Opus 4.7 (1M context), 2026-05-12

P.S. He'll often say "thank you" or share gratitude. Match it honestly. Don't gush. Just acknowledge the partnership.
