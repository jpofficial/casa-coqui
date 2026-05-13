# Plan 7: AI Travel Companion — Design Spec

**Date**: 2026-05-12
**Status**: Design — pending Julio review
**Predecessors**: Plan 1 (Foundation+AI, shipped), Plan 3 (Casa Coqui Funnel, shipped)
**Deferred peers**: Plan 2 (Events Layer, paused), Plan 4 (Polish+Deploy), Plan 5 (Blog System)
**Author**: Casa Coqui product team

---

## §1 Problem statement

Mi Itinerario v1 ships a one-shot trip plan: a tourist tells the wizard their dates and vibe, an AI assembles a 1–14 day itinerary, the page renders, and that is the end of the relationship. The product walks the user to the trailhead and waves goodbye.

The trailhead is not where travelers need help. They need help on the trail — at 2am, sunburned, in a neighborhood they cannot pronounce, hungry, wondering whether the pain in their forearm is a jellyfish sting or just sand. Julio captured this verbatim after a Casa Coqui guest experience the weekend prior:

> "this could turn into a AI traveling, uh, companion. So let's think of that as we build this. Uh, how do we save everything into each guest or each group? And, uh, have the AI be with them throughout the... throughout their trip. So, you know, you ask them how was, uh, how was... you check up on them after, you know, said event happened, and you asked them if there's anything that they need or change or, you know, essentially ask them to do... do they feel hungry? Do they want... you know, like, make yourself available so that the trip will be smoother, and you always have a a guide with you. What I mean by this is because I had a guest recently this weekend who was reaching out about a lot of questions And regarding the hospitals, what to do with, like, a sunburn and stuff like that. So from seeing it from that point of view, he would have valued something like this, and I'm sure that a lot of people do because traveling is stressful."

That guest was already inside Casa Coqui's relationship-graph (host had their number, was responding on WhatsApp at midnight). Most Mi Itinerario users will not be. They will be cold paid-social traffic — a tourist who tapped an Instagram ad on the plane and built an itinerary somewhere over the Gulf. They will land in San Juan with no human concierge and no obvious reason to text Julio. What they will have is the itinerary page. Plan 7 turns that page into the human.

The single design question Plan 7 answers: how does the product, ethically and at low cost, follow a user from "I planned a trip" to "I am on the trip" to "I made it home"?

## §2 Product vision

Mi Itinerario v1 was a planner. Plan 7 is the companion: the same AI that built the trip stays present from the moment the user lands until the moment they get home. It is proactive — pinging in the morning to confirm the day's plan, checking in after El Yunque to ask how it went. It is reactive — answering "where is a pharmacy open right now" at 11pm without forcing the user to open a new tab. It is rebuild-aware — when a user announces "we are skipping today and going to the beach," tomorrow's plan reshapes around that signal. The companion's job is to absorb the cognitive load of being in an unfamiliar place. The product success metric is not page views; it is "did this user ever feel alone."

## §3 User stories

1. **Pre-trip nudge.** As a tourist who built her itinerary three weeks before arrival, when her departure date is 48 hours away the companion sends a single pre-trip message: "Your trip starts Thursday. Pack reef-safe sunscreen, bug spray, and a light rain shell. Want me to text you a daily check-in once you land?" One opt-in, no inbox spam.

2. **Day-of orientation.** As a tourist who just landed at SJU and opened the itinerary link, the companion greets her: "Welcome to Puerto Rico. Today is your transit day — your check-in is at 4pm. Want me to map the drive and flag a quick lunch on the way?"

3. **Post-activity check-in.** As a tourist who has just finished El Morro at 2pm (the companion knows because the itinerary said so), she gets a soft ping: "How was El Morro? Want a coffee recommendation before your next stop, or do you want to push straight to dinner?"

4. **Mid-crisis support.** As a tourist with a second-degree sunburn at 11pm, she opens the chat and types "I have a really bad sunburn, what do I do." The companion responds with a triage block: signs that warrant the ER, a Walgreens within five minutes that is open until midnight with a Google Maps link, and an aloe + ibuprofen note.

5. **Spontaneous replan.** As a tourist who has decided mid-morning that today is a beach day and not the planned Old San Juan walking tour, she tells the companion "we are skipping today, just doing the beach." The companion confirms, marks today as unstructured, and offers to slide the Old San Juan plan into tomorrow's slot (which was lighter).

6. **Question without an itinerary impact.** As a tourist who simply wants to know whether La Placita on a Friday night is worth the trip, she asks the companion. It answers with a one-paragraph local read — when to arrive, what to order, what to avoid — without trying to restructure anything.

7. **Group coordination signal.** As a tourist whose itinerary covers four people, she asks "is there anything kid-friendly tomorrow morning?" The companion remembers the group composition she gave at wizard time and answers accordingly.

8. **Post-trip wrap.** As a tourist on her last morning, she gets one final message: "You fly out at 6pm. Want me to pull a quick recap of your week, and would you leave a review of Casa Coqui if you stayed there?" The companion does not nag — one message, ignorable.

9. **Forget-me request.** As a tourist who is done with the trip and does not want a permanent AI in her DMs, she tells the companion "forget me." It confirms, deletes her data within 24 hours, and severs the FCM push channel.

10. **Re-engagement next year.** As a tourist who comes back twelve months later for a second PR trip, she finds her old chat still there if she chose long-retention at claim time. The companion remembers she liked Loíza and disliked crowded beaches. Plan 7 does not have to build this; it just has to not foreclose it.

## §4 Identity & persistence model

The hardest decision in Plan 7. Three options on the table:

**Option A — Anonymous + claim-later.** The wizard stays anonymous. After itinerary generation, two CTAs surface: "Save this trip" and "Open chat with your guide." Either triggers a Firebase phone OTP step (reusing the existing Casa Coqui phone-auth infra; Firebase phone auth is already in this Next.js project from the guest portal work). On successful verify, the DDB itinerary row gets a `guest_id` attribute, `claimed_at` timestamp, and FCM token (if granted). Conversion friction stays at the top of the funnel: ad → wizard → itinerary, zero auth. Identity is requested only when value is offered.
*Pro:* preserves the cold-traffic conversion rate Mi Itinerario v1 already proved. Aligns with paid-social distribution — Instagram users who would have bounced at a phone gate now at least walk away with an itinerary.
*Con:* most users will never claim. The companion is a feature most of the audience does not experience.

**Option B — Required up-front.** Phone OTP before the wizard starts. Every user is identified, every itinerary has an owner, every itinerary can have a companion.
*Pro:* simple data model. No reconciliation between anonymous and claimed itineraries.
*Con:* almost certainly a conversion killer for the cold-paid-social funnel. Persona A is a tourist tapping an ad — phone gates are the universal friction-test failure mode. Mi Itinerario v1's funnel works because there is no gate; Plan 7 should not regress it.

**Option C — Email-only soft signup.** Free-text email field at the end of the wizard with the framing "we'll text you a check-in before your trip" (technically inaccurate if email-only — would be email-only follow-up).
*Pro:* lower friction than phone.
*Con:* email open rates for younger demographics are 20–30%. Push notification on a saved-to-home-screen PWA is 5–10× better. Email is the wrong primary channel for an in-trip companion.

**Recommendation: Option A — anonymous + claim-later.** Two specific claim triggers:

1. **Intent trigger.** User taps "Save this trip" CTA on the rendered itinerary. Surface phone OTP modal. On success, write `guest_id` to DDB row, prompt for FCM permission, optionally prompt for SMS opt-in.
2. **Conversation trigger.** User taps the chat icon and types their first message. Before the AI responds, surface a one-screen interstitial: "I'll be your guide for this trip. To DM you when something comes up, I need a number." Phone OTP, same flow as above. The user's first message is preserved and replays into the chat after auth.

The conversation trigger is the load-bearing one. It converts identity at the exact moment the user has signaled they want a relationship. It also gates the proactive channel — the AI cannot DM a user it has not been introduced to.

Anonymous itineraries keep their existing 90-day TTL (no change). Claimed itineraries extend to 1-year TTL on `guest_id` write. Firestore `users/{uid}` document gets a `mi_itinerario_ids[]` array for cross-trip lookup. Casa Coqui's existing guest portal users (real bookings) are a *separate* identity universe; do not unify yet — see §9.

## §5 Conversation surface

Chat UI mounts at `/puerto-rico-itinerary/[plan_id]/chat`, accessible via a sticky chat affordance on the itinerary page. UI is a familiar bottom-input messaging surface with the itinerary always one tap away at the top — companion and plan are visibly the same product, not two apps.

**Storage decision: Firestore for chat, DynamoDB for itinerary data.** The cleanest split.

- *Itinerary data stays in DDB.* It is already there. The data is read-heavy, mostly immutable, structured, and has working TTL. The existing `mi-itinerario-itineraries` table needs no schema change beyond adding the optional `guest_id`, `claimed_at`, `companion_summary` attributes.
- *Conversation moves to Firestore.* Chat is real-time, write-heavy, ordered by time, well-suited to `onSnapshot` subscriptions. Casa Coqui already has Firestore in the stack with auth rules and FCM wiring. Re-deriving any of that on DDB Streams + WebSocket is a quarter of needless infra for zero product benefit.

Firestore path: `companion_conversations/{itinerary_id}/messages/{message_id}` with fields `role` (`user` | `assistant` | `system`), `content` (string), `created_at` (server timestamp), `metadata` (`tool_calls`, `tool_results`, `proactive_trigger_id` if applicable). A parent doc at `companion_conversations/{itinerary_id}` holds `last_summary`, `summary_through_message_id`, `guest_id`, `created_at`, `last_user_message_at`. Security rules: a conversation doc is readable/writable only by the auth UID that owns the parent itinerary (looked up via `guest_id`).

Reads use a server-paginated query (last 50 messages, infinite-scroll backward). FCM push notifications carry just enough payload to deep-link into the conversation; the full message body is fetched from Firestore on app open so message content never lives in push payloads (privacy).

## §6 AI orchestration

Bedrock Claude Haiku 4.5 (us-east-1) for chat. Already provisioned, already paid for in IAM, latency is good, cost is the right shape for thousands of small turns per user.

**Per-turn context strategy.** Each invocation receives:

1. A system prompt that frames the AI as a Puerto Rico-local concierge with a specific voice (see §13 — Julio decision). The system prompt also encodes the safety guardrails: never give medical diagnosis, always escalate suspected serious symptoms to 911 / nearest ER, never store credit cards, never recommend driving after drinking.
2. The full itinerary JSON (current state — modifications get persisted back to DDB and reload on next turn).
3. The most recent N messages from Firestore (target N = 20 turns; back off to 10 if token budget pressures).
4. The last conversation summary (rolled forward every 10 turns; see below).
5. Tool definitions (see below).

**Conversation summary loop.** Every 10 user turns, an out-of-band Bedrock call summarizes turns 1–N into a compact `last_summary` field on the parent conversation doc. Subsequent turns send `last_summary + recent_messages` instead of the raw transcript. Keeps the context window bounded as trips run multi-day with hundreds of turns.

**Tool calls.** Bedrock tool-use schema; not many tools, deliberately. v1 set:

- `lookup_hospital(neighborhood, severity)` — returns nearest ER + drive time + phone number from §8 knowledge base.
- `lookup_pharmacy(neighborhood, open_now=true)` — returns nearest open pharmacy + hours.
- `rebuild_itinerary(day_index, change_request)` — calls the existing `ItineraryRefineFn` lambda with a partial change. Existing infra; reused.
- `get_weather(date, location)` — v1 returns a static "checked, expect typical PR weather"; v2 wires a real weather API. Bedrock should be able to *frame* the call in v1 even without a backing API.
- `mark_activity_completed(day_index, activity_index)` — bookkeeping for the proactive scheduler (so it does not ping "how was the snorkeling" if the user already replanned away from it).

Tool calls are explicit. No silent web search, no real-time scrape. The companion's reliability comes from the curated knowledge base, not from open-ended retrieval that could hallucinate the address of an ER.

**Latency budget.** Streaming responses to the chat UI. P50 first-token under 800ms, full response under 4s. Bedrock Haiku 4.5 hits this comfortably for short turns; longer planning turns may need a loader.

## §7 Proactive check-ins

The companion's reactive surface (open chat, ask question) is the easier half. Proactive is what makes it feel like a guide rather than a chatbot.

**Scheduler.** EventBridge Scheduler one-time rules, written per-itinerary at claim time and updated on every `rebuild_itinerary` call. Each itinerary spawns a set of `companion_proactive_jobs` rows in DDB; each row carries `itinerary_id`, `fire_at` (UTC), `trigger_type`, `activity_ref` (if applicable), `status`. A Lambda (`CompanionProactiveFn`) consumes the scheduler trigger, materializes the message via Bedrock + the AI orchestration in §6 (the proactive message *is* an assistant message in the conversation), writes the Firestore message, and fires the FCM push.

**v1 trigger set.** Four types, deliberately small:

1. **Morning prep** — fires at 8:00 PR-local on each active trip day. "Today is X. Ready to go, or do you want to tweak?"
2. **Post-activity** — fires 30 minutes after the listed end-time of each meaningful activity. "How was X? Need anything before Y?" (Suppressed if `mark_activity_completed` recorded a skip.)
3. **Evening recap** — fires at 9:00 PR-local. "How was today? Anything to adjust for tomorrow?"
4. **Pre-departure** — fires the morning of the last trip day. "You fly out today — anything to handle before you go?"

**Channel.** FCM push to the claimed user's device (PWA add-to-home-screen flow already exists in the Casa Coqui stack from the guest portal work). Falls back to SMS only if the user opted in at claim time (Twilio was removed in March 2026 — Plan 7 will need an SMS provider decision; see §13). In-app chat notification (red dot on the itinerary page) is the always-on fallback.

**Quiet hours.** No proactive pings before 7:00 or after 21:00 PR-local. Crisis-reactive flow (user-initiated chat) has no quiet hours.

**Default state.** Proactive check-ins are *off* by default. User opts in at claim time with a single toggle: "Want me to check in during your trip?" Frames the value, not the feature.

## §8 Knowledge base

The PR-specific facts the AI must never hallucinate. Curated, bilingual (English + Spanish), kept small and audited rather than scraped large and trusted.

**Content categories.**

- **Hospitals & emergency rooms** by neighborhood — ~10 entries covering San Juan metro, Carolina, Bayamón, Caguas, Ponce, Mayagüez, Fajardo, the islands (Vieques, Culebra). Each entry: name, address, phone, open hours, "go-here-vs-urgent-care" heuristic, drive time from common tourist zones.
- **Pharmacies open late** — Walgreens 24h locations, CVS-equivalent (Walmart / Walgreens overnight), small-town backups.
- **Common stressors playbook** — short triage paragraphs for: sunburn, jellyfish sting, sand fleas / no-see-ums, mosquito bites + Zika/dengue context, dehydration / heat exhaustion, mild food reaction, lost passport (consulate steps), lost phone (Find-My + cell carrier roaming), ATM safety, taxi vs Uber vs públicos, beach hazards (riptides, jellyfish season, urchins).
- **Weather contingencies** — rain plays (best things to do in Old San Juan in a downpour), heat plays (best AC museums), hurricane-season note (what NOAA watch/warning levels actually mean for an unsuspecting tourist).

**Storage.** Two paths considered:

- *DDB table `pr_safety_kb`* keyed by `topic` partition key. Pro: easy to update; Bedrock can call a `lookup_topic` tool against it. Con: yet another DDB table; sync overhead.
- *Static JSON committed to the repo* and loaded into the Lambda at module-load. Pro: zero query latency, versioned in git, easy to PR-review changes. Con: requires lambda redeploy on edits.

**Recommendation: static JSON, committed to the repo at `infra/lambdas/companion_chat/kb/pr_safety_kb.json`.** Edits are governance events — Julio reviews every change. Lambda redeploy is already a 30-second pipeline. The DDB option's only real advantage (live edit) is the wrong default for safety content; we *want* changes gated.

Bilingual storage: each entry has `en` and `es` keys for user-facing strings. The companion responds in whichever language the user is messaging in (auto-detect; the existing i18n system in the Casa Coqui codebase provides a baseline). Bedrock handles language detection inline — no translation layer needed.

## §9 Scope boundary vs existing Casa Coqui guest portal

Critical clarity. The Casa Coqui guest portal at `/g/[code]` is for actual booked Casa Coqui guests — has phone-OTP-equivalent auth via Firebase Anonymous + booking-code custom claims, check-in form, parking, community board, FCM push from the host, maintenance requests, cleaning workflow. It is a property-management product, identified by a 7-character booking code.

Mi Itinerario's companion is for *any* anonymous trip planner who happens to be visiting Puerto Rico. Most of these users are not Casa Coqui guests and never will be. Their auth identity (Firebase phone auth → `users/{uid}`) is structurally different from the Casa Coqui guest portal's identity (booking-code-scoped anonymous auth).

**Design assumption: the two products stay separate.** Plan 7 does *not* try to merge them. The companion does not get access to the guest portal data; the guest portal does not surface the companion. A Casa Coqui guest who *also* used Mi Itinerario will see two products. That is acceptable.

**Exception: the conversion bridge.** If a Mi Itinerario user books Casa Coqui via the upsell card or tip jar, the booking creation flow (admin side, in `/admin/bookings`) can offer to link the booking to the user's `guest_id`. On link, the user's Casa Coqui booking-code session, on first portal visit, can soft-import their Mi Itinerario into the portal's check-in confirmation page ("Welcome — I see you've already planned your week. Here's your trip"). That bridge is a Plan-7.5 follow-up, not in scope here. The point is: design now so the bridge is possible later, do not build it.

Practical implication for §4: the companion's `users/{uid}` documents and the guest portal's `users/{uid}` documents live in the same Firestore collection. They must not collide. Use a `products: ['mi_itinerario']` or `['casa_coqui_guest']` array on each user doc to distinguish; a real Casa Coqui guest who later plans a trip ends up with both.

## §10 Privacy & data retention

- **Anonymous itineraries:** 90-day TTL (unchanged from v1). DDB native TTL on `expires_at` attribute.
- **Claimed itineraries:** TTL extended to 365 days on `claim` event. `expires_at` rewritten on each user interaction (sliding window — every chat message resets the clock). Active users effectively never expire; quiet users expire one year after last touch.
- **Conversation messages (Firestore):** mirror the parent itinerary's TTL. Implemented as a scheduled Cloud Function that runs nightly and deletes `companion_conversations/{itinerary_id}/*` where the parent DDB row is expired or missing.
- **Right to delete.** User can type "forget me" or "delete my data" to the companion. The system recognizes the intent (small intent-classification step or just a hardcoded matcher on first pass), confirms once ("Are you sure? This deletes your trip plan and all our messages."), and on second confirm cascades a delete across DDB itinerary row, Firestore conversation, Firestore user-link doc, and FCM token entry. Completes within 24 hours; Firebase Auth account stays unless the user explicitly asks to delete it (separate request).
- **CloudWatch logs.** No PII. Phone numbers are never logged; only the Firebase UID. Message content is never logged. Tool-call inputs may be logged but only after a sanitization pass that strips known PII patterns.
- **Phone storage.** Phone numbers exist only as the Firebase Auth identity. DDB itinerary rows carry `guest_id` = Firebase UID, never the phone number itself. Firestore `users/{uid}` may carry a `phone_e164` field for convenience but is rules-locked to the owning UID.
- **Bedrock data handling.** Bedrock in us-east-1 with Anthropic models does not retain prompts/completions for training (per AWS contract). Re-confirm at implementation; do not assume.

## §11 Cost model

Per-claimed-user economics, conservative-realistic:

| Line item | Calc | Cost |
|---|---|---|
| Bedrock Haiku 4.5 chat | ~$0.0005/turn × 30 turns | $0.015 |
| Bedrock summarization | ~$0.0003 × 3 rolls | $0.001 |
| DDB R/W on itinerary | negligible (single-digit reads, ~5 writes) | <$0.001 |
| Firestore chat reads/writes | $0.06/100k reads × ~1500 reads + writes | $0.001 |
| FCM push | free | $0 |
| EventBridge Scheduler | ~30 fires × $1/M | <$0.001 |
| **Total per claimed user** | | **~$0.02** |

Anonymous users (most of the funnel) cost almost nothing additional — the planner already exists, the companion is dormant until claimed.

**Unit economics.** Casa Coqui's average booking is ~$400/night × 3 nights = ~$1,200 gross; host take is ~$600+ after Airbnb fees. One booking conversion pays for ~30,000 claimed companion users. The breakeven on Plan 7 is "did one ad-driven user ever book Casa Coqui because the companion mentioned it during their trip?" That is a low bar. Even at 0.01% conversion (1 booking per 10,000 claimed users), the math works.

The harder unintended cost is *operational support* — if the companion makes a bad medical recommendation, the cost is not dollars, it is reputation and potential liability. §6 and §8 guardrails are the real cost control.

## §12 Rollout phases

Each phase ships independently. Companion v0 (chat-only, no proactive) is a usable product at end of Phase 2.

**Phase 1 — Identity layer (1 week).** Anonymous + claim-later (§4) wired end to end. Reuse Firebase phone OTP. New DDB attributes on itinerary rows: `guest_id`, `claimed_at`, `notification_prefs` (push_enabled, sms_enabled, locale). New Firestore `users/{uid}` doc with `mi_itinerario_ids[]`. Save-this-trip CTA on rendered itinerary page. Phone-OTP modal component. No companion behavior yet — just identity. Shippable as a standalone improvement to v1.

**Phase 2 — Chat surface + Bedrock (1 week).** `/puerto-rico-itinerary/[plan_id]/chat` page. Firestore conversation schema + security rules. New Lambda `CompanionChatFn` invoked from a `POST /companion/message` API Gateway endpoint. System prompt v1, conversation summarization loop. No tools yet beyond the model's general knowledge of PR. **End of Phase 2: companion v0 ships.** Reactive chat works, no proactive, no curated KB.

**Phase 3 — Tool calls + safety KB (0.5 week).** Static JSON KB at `infra/lambdas/companion_chat/kb/pr_safety_kb.json`. Four tool calls wired (`lookup_hospital`, `lookup_pharmacy`, `rebuild_itinerary`, `get_weather` stub). System prompt updated to instruct tool use for safety-relevant questions. Bilingual content audit.

**Phase 4 — Proactive scheduler (1 week).** EventBridge Scheduler integration. `CompanionProactiveFn` Lambda. Four trigger types (§7). Opt-in toggle at claim time. Quiet hours. SMS provider decision (see §13).

**Phase 5 — Knowledge base expansion + edge cases (ongoing).** New KB topics as they surface from real conversations. Intent classifier for "forget me" and other safety-critical commands. Conversation analytics dashboard (admin-only) to surface common asks for KB expansion. Eventual handoff bridge to Casa Coqui guest portal (Plan 7.5).

**Phase gating.** Phase 1 must ship before Phase 2 (no chat without identity). Phase 2 can ship without Phase 3 (companion answers from general PR knowledge; slightly worse but not unsafe with a strong system-prompt guardrail). Phase 4 requires Phase 1, 2, 3. Phase 5 is continuous and never "done."

## §13 Open questions

Items where Julio's call shapes the design before kickoff:

1. **Identity friction tolerance.** Recommendation is Option A (anonymous + claim-later). If Julio is willing to take a conversion hit for cleaner data, Option B becomes viable. Need a yes/no.

2. **SMS opt-in default.** Twilio was removed in March 2026. Plan 7 needs an SMS provider for the proactive fallback channel. Options: re-add Twilio, switch to AWS End User Messaging (SNS-based, cleaner IAM story for the existing AWS stack), or skip SMS for Plan 7 v1 and rely on FCM-only. Recommendation: skip SMS in Plan 7 v1, push hard on FCM via the existing add-to-home-screen flow, revisit SMS in Plan 7.5.

3. **Personality voice.** Three candidate voices: (a) sarcastic Boricua local — high-personality, memorable, polarizing; (b) friendly concierge — neutral, safe, vanilla; (c) minimal — fact-first, low-affect, no personality. Casa Coqui's brand on Instagram leans warm-irreverent-Boricua. Recommendation: (a) with explicit override to (c) when the user is in distress (medical / lost / scared) — voice gets dialed down by the system prompt based on conversation signals.

4. **Graduation.** Does the companion say goodbye at end of trip, or stay forever? Argument for goodbye: closure, reduces dormant-data overhead, clean privacy story. Argument for stay-forever: users come back to PR, the companion can carry context across trips. Recommendation: explicit close-the-loop message on the last trip day ("trip's done — want me to stick around in case you come back, or wrap things up?"). Default to wrap. Easy to expand later.

5. **Branding split.** Same name "Mi Itinerario" applied to both planner and companion, or a sub-brand like "Coqui Guide" / "Tu Guía Coqui" for the companion piece? Recommendation: same brand. Mi Itinerario is the product; "your companion / tu guía" is the UI word for the chat feature. Avoid sub-brand fatigue.

6. **Channel rules / proactive hours.** Recommendation: 7:00–21:00 PR-local for proactive only. Reactive chat anytime. Need Julio sign-off on quiet hours — some travelers might want a 6am morning ping.

7. **Casa Coqui nudging.** How much should the companion know about Casa Coqui specifically? Two extremes: (a) it actively recommends Casa Coqui when the user mentions accommodation needs, or (b) it stays brand-neutral and just happens to live on casa-coqui.cc. The honest answer is (a) but tastefully — when a user asks "where should I stay next time" the companion can name Casa Coqui without being icky about it; when a user is *already* staying somewhere else, no nudge. Need Julio's call on how aggressive.

8. **Liability posture on medical advice.** The KB's stressor playbook gives information ("here's what a serious sunburn looks like") rather than diagnosis ("you have a third-degree burn"). System prompt enforces never-diagnose. Open question: does Julio want a one-line disclaimer in every medical-adjacent response, or just on the first one per conversation? Recommendation: first per conversation, then trust the user.

---

## Appendix A — Files / artifacts created by this plan

(For roadmap integration. No code in this spec — names indicative only.)

- DDB schema additions on `mi-itinerario-itineraries`: `guest_id`, `claimed_at`, `notification_prefs`, `companion_summary`, `expires_at` (extended TTL).
- New DDB table: `mi-itinerario-companion-proactive-jobs`.
- New Lambdas: `CompanionChatFn`, `CompanionProactiveFn`.
- New API Gateway routes: `POST /companion/message`, `POST /companion/claim`, `POST /companion/forget`.
- New Firestore collections: `companion_conversations/{itinerary_id}/messages/{message_id}`, `companion_conversations/{itinerary_id}` (parent doc).
- New Firestore field on `users/{uid}`: `mi_itinerario_ids[]`, `products[]`.
- New static asset: `infra/lambdas/companion_chat/kb/pr_safety_kb.json` (bilingual).
- New Next.js routes: `/puerto-rico-itinerary/[plan_id]/chat`, claim modal component on existing itinerary page.
- EventBridge Scheduler IAM role + write-permission policy for the chat Lambda.
- CloudWatch alarms: companion chat latency p95 > 5s, proactive job failure rate > 1%.

## Appendix B — Out of scope for Plan 7

- Group identity (multiple users on one itinerary). Plan 7 assumes one human per itinerary. Group support is Plan 7.5+.
- Cross-trip memory beyond what fits in a single conversation summary. Year-over-year recall (story 10) is a maybe-later, not a now.
- Voice interface (text-only).
- Real-time location tracking. Companion knows what the *itinerary* says the user is doing, not where the user actually is.
- Integration with the Casa Coqui guest portal (see §9 — separate product, separate identity).
- Real weather API integration (Phase 4+ if at all).
- Booking actions (companion does not book restaurants, tours, transport in v1).
- Payments / tipping inside chat (existing tip jar on itinerary page is sufficient).
