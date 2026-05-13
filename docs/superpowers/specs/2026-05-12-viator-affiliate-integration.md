# Viator Affiliate API — Application & Integration Reference

**For:** Julio Perez (Casa Coqui + Mi Itinerario)
**Date:** 2026-05-12
**Status:** Pre-application reference; integration plan is provisional pending API approval
**Live product:** https://www.casa-coqui.cc/puerto-rico-itinerary

---

## §1 Why Viator

Mi Itinerario is an AI-powered Puerto Rico trip planner that you've been driving paid traffic to via Instagram and Facebook ads. The current activity database is 75 hand-curated entries, plus 3 new files being added today (adventure, family, unique). It's a strong foundation, but it has two structural limits:

1. **Catalog ceiling.** Hand-curation tops out at maybe 200 entries before maintenance becomes a job. Viator carries hundreds of bookable Puerto Rico activities — including the long-tail (cooking classes, niche bioluminescent kayak operators, mofongo tours, El Yunque sunrise hikes with specific guides) that you'd never reasonably maintain by hand.
2. **Revenue ceiling.** Right now Mi Itinerario is pure top-of-funnel: it sells Casa Coqui as the upsell. Every itinerary view that doesn't end in a Casa Coqui booking is wasted attention. Viator's affiliate program pays **8% commission** on bookings driven by an affiliate-tagged link, plus a tiered referral bonus when you cross monthly thresholds.

So Viator does two things at once: it makes the recommendation engine genuinely useful (broader catalog beats curated 9 times out of 10 once the curation is exhausted) and it turns the activity layer itself into a revenue line, not just a funnel for Casa Coqui. For an ad-driven app where every dollar of traffic needs to monetize, that's a meaningful change to the unit economics.

The structural fit is also unusually good. Viator's affiliate ToS rewards apps that show real intent — recommendation engines, itinerary builders, trip planners — over generic affiliate spam. "AI-powered planner that produces a personalized itinerary the user came here to build" is exactly the pitch Viator wants to see.

---

## §2 Application — what you submit

Apply at **https://www.viator.com/affiliates** — that's the canonical entry point for the affiliate program (verify the exact URL before submitting; Viator occasionally renames "affiliates" to "partners"). The form should ask for:

- **Business / brand name:** Mi Itinerario (or Casa Coqui LLC, whatever the legal entity is)
- **Website URL:** `https://www.casa-coqui.cc` — and call out the subroute `/puerto-rico-itinerary` as the surface where Viator products would appear
- **Business email:** an email you actually read; approvals and the API key go here
- **Brief description of how you'll promote Viator products:** two or three sentences. Suggested framing: *"Mi Itinerario is an AI-driven trip planner for Puerto Rico. After a user completes a short interest wizard, we generate a multi-day itinerary with activity recommendations. Where a recommendation matches a Viator product, we display a 'Book on Viator' link tagged with our affiliate ID. Recommendations are filtered by user-stated interests, not generic affiliate placement."*
- **Expected monthly volume:** be honest but optimistic. Pull your current ad-driven traffic from analytics and project conservatively. "Currently ~X visitors/mo, ramping to Y over 6 months" reads better than a number you can't back up.
- **Tax info (W-9 for U.S.):** they'll ask for this to pay you. Have it ready.

### Approval timeline
Viator publicly says 5–15 business days. Realistically expect 2–3 weeks; they manually review applications, especially for apps that aren't a blog or coupon site (yours is neither). Don't block on it.

### What gets you approved
- A live, polished site (you have one)
- Clear intent — recommendation engine, not link-dumping (you have one)
- A specific niche (Puerto Rico) — narrow niches outperform generic travel affiliates in Viator's eyes
- Real traffic numbers, even if small. If the ads are running, screenshot the analytics.

### What gets you rejected
- Empty placeholder sites
- "Affiliate network" patterns (lots of outbound affiliate links, no editorial)
- Suspect domains
- Refusal to disclose how you'll promote

You're clear of all of these.

---

## §3 Once approved — what you get

Viator will email you:

- An **API key** (typically `exp-api-key` style header credential)
- The **partner portal login** (usually at `partner.viator.com` or similar; verify)
- API base URL — typically `https://api.viator.com/partner/` for v2 endpoints. **Do not hardcode this from memory; use whatever the welcome email and the partner docs specify.**
- An **affiliate ID** that gets appended to outbound links so commissions track

### Endpoints that matter for Mi Itinerario

The Viator Partner API surface is large; we only need a small slice:

1. **Product search by destination** — query Puerto Rico (or sub-destinations like San Juan, Vieques, El Yunque). Returns product codes, titles, prices, ratings, review counts, thumbnails.
2. **Product details** — for any product code, returns full description, hours, included/excluded items, available dates, full photo set, cancellation policy.
3. **Availability check** (optional for MVP) — does this product run on date X? Skip for v1; surface "check availability on Viator" link instead.
4. **Affiliate link builder** — constructs a deep link tagged with your affiliate ID. Some Viator APIs return the affiliate URL directly with the product; others require you to template it. Verify on approval.

### Rate limits
Typical for new affiliates: **100–500 requests/day**, scaling with revenue. Plenty for a nightly sync of one destination. Don't query Viator on every user request — sync to your own DDB and serve from there.

---

## §4 Integration plan (engineering, not code)

Here's how this slots into the existing Mi Itinerario stack. Three days of work, give or take.

### 4.1 New DynamoDB table: `viator-products`

Mirror the schema of `mi-itinerario-activities` so the loader doesn't care which source an activity came from. Extra fields:

- `viator_product_code` (PK) — Viator's stable identifier
- `affiliate_url` — pre-built deep link tagged with your affiliate ID
- `source` = `"viator"` (vs. `"curated"` for the existing table)
- `rating`, `review_count` — for quality filtering
- `last_synced_at` — to spot stale records

### 4.2 New Lambda: `ViatorSyncFn`

- **Trigger:** EventBridge nightly cron (`cron(0 6 * * ? *)` UTC, ~2am AST)
- **Job:** call Viator product-search for Puerto Rico, paginate through results, fetch product details for new/changed items, upsert into `viator-products` DDB table
- **Filtering at sync time:** drop anything with `rating < 4.0` or `review_count < 50`. Better to have 200 great products than 800 mediocre ones — quality is the moat.
- **Runtime:** ~5 minutes for a full Puerto Rico sync. Well under Lambda's 15-min ceiling.
- **Cost:** trivial; one Lambda invocation/day plus DDB write capacity that's already provisioned.

### 4.3 Loader change in `itinerary_generate` Lambda

Extend `loadActivities` to scan **both** tables (`mi-itinerario-activities` AND `viator-products`) and merge results. Tag each activity with its `source` field so the prompt and UI know what they're working with.

The LLM ranking step doesn't need to change — it already scores by interest match. Curated and Viator items compete on the same playing field, which is correct: a great Viator-sourced cooking class should beat a mediocre curated beach.

### 4.4 ActivityCard UI

For `source === "viator"` items, render a **"Book on Viator →"** primary CTA pointing at `affiliate_url`. Existing curated items keep showing their current Website + Map + IG icons. Don't mix — Viator items don't need the IG icon (we don't curate their handles), and curated items don't need the Viator CTA.

### 4.5 Click tracking

Extend the existing `data-event-name="activity_link_*"` pattern with `activity_link_viator_book`. Wire it through whatever analytics you're already using (GTM/GA4/PostHog/whatever). The goal: measure click-through rate from itinerary to Viator, then conversion rate from Viator click to booking (Viator's partner dashboard reports the latter; you control the former).

Once you have both numbers, you can A/B card placement, copy, and ordering to optimize.

---

## §5 Risks and tradeoffs

**Quality dilution.** Viator's catalog contains some genuinely bad operators. The `rating >= 4.0, reviews >= 50` filter handles most of it, but you should spot-check the synced table weekly for the first month and blocklist any junk that slips through. Add a `blocklist` field or a separate blocklist table.

**Cold-start delay.** Approval can take 2–3 weeks. The curated-activity expansion you're running today (research subagents on adventure, family, unique) is the right parallel play — it ships value this week regardless of Viator's timeline.

**FTC disclosure (U.S. law).** You must disclose that you earn commission. A single line in the footer is enough: *"Some activities link to Viator. We earn a small commission on bookings, at no extra cost to you."* Honest, unobtrusive, doesn't impair conversion. Put it in the activity card area too if you want belt-and-suspenders compliance.

**Brand split.** Risk: the experience starts feeling like an aggregator and loses the "curated by a Puerto Rican host" trust signal that makes Mi Itinerario work. Mitigation: keep curated items first in the ranking when scores are close; treat Viator as supplemental, not primary. Show curated items' first-person voice ("we love this place") and let Viator items render in a more neutral tone.

**Vendor dependency.** If Viator changes commission rates or API terms, you're exposed. Keep the curated layer alive and growing — it's your moat and your fallback.

---

## §6 What you do this week

1. **Today (5 min):** Apply at https://www.viator.com/affiliates. Use the application talking points in §2.
2. **Today:** Add a calendar reminder for 14 days from now to check application status. Reply to any Viator email within 24 hours — they sometimes ask follow-up questions.
3. **This week:** Continue the curated-activity expansion already in flight (the research subagents working on adventure, family, unique). Ship those regardless of Viator's timeline.
4. **On approval:** Share the API key with the dev team via 1Password / secure channel — never paste it in chat or commit it. Engineering integration is roughly **3 working days**: 1 day for DDB table + sync Lambda, 1 day for loader + UI changes, 1 day for tracking + QA + filter tuning.

---

## §7 Alternatives if Viator denies or stalls

If approval is denied or takes more than a month, three fallbacks:

- **GetYourGuide Partner Program** — comparable commission (~8%), generally faster approval, smaller Puerto Rico catalog than Viator but covers the major operators. Reasonable plan-B.
- **Tiqets** — smaller overall, but they have decent coverage for ticketed Puerto Rico experiences (El Morro, Bacardí tours). Worth adding as a *third* source even if Viator approves.
- **Direct partnerships with Puerto Rico operators** — Carabalí, Toro Verde, Bacardí, the bioluminescent bay operators. Case-by-case outreach, no API, manual link-building. Higher commission (often 15–20%) but real legwork. Worth pursuing for the top 5–10 operators independent of any affiliate network.

The best long-term setup is probably **Viator + 2–3 direct partnerships for the marquee experiences**. Viator gives you breadth; direct partnerships give you margin on the highest-volume bookings.

---

## Appendix: Verify before you submit

- Confirm the live affiliate signup URL is `https://www.viator.com/affiliates` (Viator has moved this around).
- Confirm whether the program is open to Puerto Rico-based or U.S.-based affiliates (it is for U.S.; PR counts as U.S. for tax purposes).
- Confirm the commission rate in the current ToS — historical rate is 8% but Viator has run promotions at higher rates for new affiliates.
- Pull current monthly traffic from your analytics before filling in "expected volume" so the number is defensible.

Once these four are checked, submit. Don't overthink the application; the worst case is a rejection email and you try GetYourGuide next.
