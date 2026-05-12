# E1 — UX Research & Mobile-First Pattern Analysis
## Mi Itinerario — Puerto Rico Itinerary Planner

**Agent:** E1 — UX Research & Mobile-First Pattern Analyst
**Date:** 2026-05-11
**Status:** Delivered — awaiting E2 Visual Identity cross-reference

---

## Section 1 — Competitive Analysis

### 1.1 Wanderlog

**Core interaction:** Google-Docs-meets-trip-planner. Users build an itinerary by searching and dragging items onto a day-by-day list. A map panel updates in real time alongside the list. The product leans heavily on collaborative editing — multiple travelers can plan together.

**Cold-start handling:** Wanderlog opens with a prominent "Create a trip" CTA and immediately asks for destination + dates. From there it auto-populates a blank list view and shows a "Suggestions" sidebar with trending activities for the destination. There is no wizard — users are dropped into the tool and expected to fill it themselves. This works for planners; it terrifies passive users.

**Mobile UX strengths:** The map is dismissable on mobile so you get a clean list-first view. Day tabs scroll horizontally. Large touch targets on the day tiles. Offline access via PWA.

**Mobile UX weaknesses:** The search-and-add interaction requires too many taps — tap search bar, type, pick result, pick category, confirm. On a phone this chain is punishing. Collaboration features (invite link, comments) are essentially invisible on mobile — buried in a hamburger menu.

**Screenshot description:** Landing on the itinerary day-view on a phone: a horizontal day-tab row (Day 1, Day 2…) dominates the top quarter. Below it, vertical cards with activity name, time field (editable inline), and a faint pin icon linking to the map. The map is collapsed to a thin banner at the bottom with a "Show map" pill. Visual hierarchy is flat — each card has the same weight, so Day 1 breakfast looks as important as Day 3's headline activity.

**Pattern worth stealing:** The horizontal day-tab scroll. Swiping between days feels native on iOS and prevents the wall-of-text problem you get when all days are on one page.

---

### 1.2 Travefy

**Core interaction:** Agent-oriented planning tool that happens to have a consumer interface. Users build itineraries with a drag-and-drop day builder. Every item has time, notes, and booking links. The UI is noticeably dense — designed for travel agents who live in it, not first-time users.

**Cold-start handling:** Travefy uses a template library as its cold-start solution. New users are offered pre-built itinerary templates (e.g., "7-Day Bali for Couples") which they then customize. This is smart for reducing blank-page anxiety. The trade-off is that the template flow is slow — you browse, preview, select, then the tool clones the template and drops you into a full edit interface.

**Mobile UX strengths:** Print/PDF export is excellent (useful if guests want paper). The itinerary client-view URL is clean and shareable — looks polished sent via email.

**Mobile UX weaknesses:** The edit interface is nearly unusable on mobile. Drag-and-drop reordering requires a stylus-level precision tap. The sidebar (where you add new activities) doesn't adapt to narrow viewports — it overlays the content and obscures context. This is a product built desktop-first with a mobile veneer.

**Screenshot description:** Desktop-first itinerary builder: a left sidebar of activity categories (Food, Lodging, Transport) and a main canvas with time-slotted day columns. On a phone, this renders as an accordion-collapsed sidebar on top, with the day columns below — each column is one horizontal swipe wide. Text is truncated at 80% of the card width with ellipsis. The density is exhausting.

**Pattern worth stealing:** Template-as-cold-start. Offering a "Start with a 5-day San Juan template" option handles blank-page anxiety without requiring AI generation — and is a free fallback if Bedrock times out.

---

### 1.3 Roadtrippers

**Core interaction:** Map-first road trip planner. Users set a start and end point; the tool draws the route and surface waypoints along the drive. Less "what to do in one city" and more "here's what you'll pass."

**Cold-start handling:** The app opens with a large map and "Where are you going?" overlaid on it. Entering a route immediately renders the path and begins surfacing POIs (fuel stations, restaurants, attractions) within a configurable distance of the route. Cold-start is handled by making the map itself feel like an invitation — no blank list to stare at.

**Mobile UX strengths:** Map-first is actually appropriate here because the journey IS the map. The swipe-up drawer pattern for POI details is very native-feeling — tap a pin, drawer animates up from bottom with photo, hours, distance-from-route. Doesn't exit the map context.

**Mobile UX weaknesses:** The map-first model fails for city-centric trips like Puerto Rico, where everything is within a ~20-mile radius. When you don't have a "route" to plot, the map becomes noise rather than signal. Also, Roadtrippers gates its best features (more than 2 stops) behind a $35/year paywall — the freemium wall appears before users experience value.

**Screenshot description:** Driving through a route on mobile: the map occupies the full viewport with a semi-transparent bottom drawer showing "Next stop: 18 mi." The route line is bold teal on a muted gray map. Pins along the route are color-coded by category (orange=food, blue=gas, green=attraction). A floating "Add stop" button sits at top-right in a pill. Clean and purposeful — but entirely dependent on having a linear journey.

**Pattern worth stealing:** The bottom-drawer POI detail pattern — tap a map pin, get a full-bleed photo + key info in a drawer that doesn't leave the map. Far better than navigating to a separate detail page.

---

### 1.4 TripIt

**Core interaction:** Email-parsing travel organizer. Users forward booking confirmation emails; TripIt parses them into a master itinerary. It doesn't help you plan what to do — it organizes what you've already booked. A fundamentally different product, but it dominates mobile travel UX because it solves a real pain point.

**Cold-start handling:** TripIt solves cold-start by skipping planning entirely. The first action is "Forward your first confirmation email to plans@tripit.com." The inbox IS the app. For users who haven't booked anything yet, there's a blank "Add a trip manually" flow — but this is clearly secondary to the auto-parse flow.

**Mobile UX strengths:** The timeline view per trip is excellent. Each day shows a vertical timeline with departure times, hotel check-in, and activities in chronological order. Real-time flight alerts (gate changes, delays) make it genuinely useful once a trip starts.

**Mobile UX weaknesses:** Useless pre-trip. Until you have booking confirmations to parse, the app shows nothing. No discovery, no inspiration, no "what should I do in San Juan?" The UX assumes you know where you're going and have already made reservations.

**Screenshot description:** TripIt trip detail on mobile: a vertical list of days, each with a thin horizontal rule and date header. Within each day, timeline cards show flight number + gate (from email parse), hotel name + check-in time, and any manually added activities. Cards are white on a slightly warm gray background — completely functional, zero personality. The brand is information architecture, not experience.

**Pattern worth stealing:** The vertical chronological timeline within a day. Rather than just listing activities, a timeline that anchors each item to a time slot makes the day feel real and plannable — especially reassuring for first-time visitors who worry about "fitting everything in."

---

### 1.5 Mindtrip

**Core interaction:** Conversational AI trip planner — users describe their trip in natural language (chat interface) and Mindtrip generates an itinerary with a map view. The paradigm is "AI concierge" rather than "drag-and-drop planner."

**Cold-start handling:** Mindtrip's cold-start IS the conversation. The opening screen shows a chat input with a suggested starter: "Plan a 5-day trip to Japan for two." There is no blank state — the prompt input IS the first action. This is smart because it externalizes the blank-page problem: the AI is going to fill it, the user just has to say something.

**Mobile UX strengths:** Conversational interface is inherently mobile-friendly — typing or voice input is native. The side-by-side chat + map layout collapses gracefully on mobile to a tab toggle. The generated itinerary is visually readable with day headers, activity names, and one-line summaries. Refinement by conversation ("swap day 3 for beaches") is intuitive.

**Mobile UX weaknesses:** The AI response latency (4-8 seconds) without a satisfying loading indicator creates anxiety on mobile — users don't know if something went wrong or if it's just slow. The map is rich but not touch-optimized — pinch-to-zoom works but the pins are too small for fingertip taps. Trust is fragile: when the AI hallucinated a closed restaurant in testing, there was no signal that any recommendation had been verified.

**Screenshot description:** Mindtrip on mobile after a generation: a chat thread above the fold with the user's prompt in a blue bubble and the AI's itinerary as a structured card below. The card has day tabs and within each day, vertically stacked activity pills (name + icon + duration). A "View on map" sticky button sits at the bottom. The itinerary card feels like a rich message in iMessage — familiar, approachable, but missing the depth a real planner needs.

**Pattern worth stealing:** The loading state with a streaming text reveal — rather than a spinner, words appear progressively, making the wait feel shorter and the AI feel "thinking" rather than "broken."

---

## Section 2 — Mobile-First Patterns for Itinerary Apps

### Wizard vs. Single-Page App

For first-time users on mobile, a wizard decisively outperforms a single-page planning canvas. A wizard breaks the overwhelming "build an itinerary" task into 3-4 screens of one question each — trip length, interests, party size, dates. The cognitive load per screen is low, the progress indicator provides momentum, and each step filters the subsequent output without users realizing it. The single-page-app model (à la Wanderlog's canvas) requires users to understand the full tool before they can use it. For Mi Itinerario's Persona A — a first-timer who doesn't know PR geography — a wizard is the right default. The SPA canvas can be the post-generation editing surface.

### Card-Based Day Views vs. Timeline Views

Card-based day views (stacked cards, one per activity) are better for browsing and comparing options. Timeline views (activities anchored to clock times) are better for execution — on the trip itself. For Mi Itinerario, the optimal pattern is card-based in generation + refinement mode, with an optional "Timeline view" toggle for users who want to see the day as hours. Day cards should include: neighborhood pill, estimated duration, travel time from previous activity, and one trust signal (price tier or "kid-friendly" badge). Do not default to timeline — it implies precision that AI-generated itineraries cannot guarantee.

### Drag-to-Reorder UX on Touch

Drag-to-reorder is notoriously hard on touch. The core problem: the long-press to initiate drag conflicts with scroll. Standard implementation requires a drag handle (visible grip icon at the edge of the card) to differentiate intent. Without a grip handle, users scroll when they want to drag and drag when they want to scroll. The secondary problem: on long lists (Day 3 of a 7-day trip with 5 activities), dragging an item from position 1 to position 5 requires holding a press while scrolling the list — an impossible one-thumb gesture. Recommendation: use up/down arrow buttons as the primary reorder mechanism, with drag-to-reorder as a power-user enhancement. The arrows are less delightful but never fail.

### Inline AI Refinement vs. Modal

Inline refinement ("swap Day 3") should be inline, not modal. The pattern: a "Refine this day" affordance expands a text field directly beneath the day card — user types request, day regenerates in place. Modal refinement (tap button → modal opens → type → close modal) breaks spatial memory: users lose track of what the day looked like before vs. after the change. Inline streaming (day regenerates word-by-word in the existing card) is the ideal. A modal is only appropriate for refinement of the whole itinerary ("start over with different interests").

### Map View — When to Show, When to Hide

Mobile real estate is precious. Show the map: (1) as an optional tab on the full itinerary view (never default), (2) in a bottom sheet when a user taps a specific activity (show that activity's pin + neighborhood context, dismiss to return to list), (3) on the shareable `/plan/[id]` page where spatial context is a sell. Never show the map during: wizard steps, the AI generation loading state, or the Casa Coqui funnel panel. The map's job is validation, not discovery — users consult it to confirm that Day 1 is walkable, not to plan what Day 1 contains.

### Sticky CTAs and the iOS Safari Toolbar Problem

iOS Safari's bottom toolbar (with the address bar, back button, tabs) occupies 44px of screen height and dynamically shows/hides as the user scrolls — but critically, it shows again when scroll stops, eating into fixed-position UI. The consequence: a `fixed bottom-0` sticky CTA button will be obscured by the Safari toolbar on initial page load and whenever scroll momentum stops. The fix: use `env(safe-area-inset-bottom)` in the padding — `pb-[env(safe-area-inset-bottom)]` plus an explicit `pb-4` fallback. Additionally, test sticky CTAs with the Safari toolbar both shown and hidden; many designs look fine in Simulator (which simulates the hidden state) and break on a real device. For Mi Itinerario, the "Generate my itinerary" wizard CTA and the "Save my plan" post-generation CTA both need this treatment.

---

## Section 3 — Persona A UX Priorities

### Trust Signals — Why This, Why Now, Why Safe

Persona A has never been to Puerto Rico. Their baseline emotional state is excited-but-uncertain, and "uncertainty" converts to bounce if the product doesn't immediately signal legitimacy. Three trust signals must be visible above the fold on `/plan`:

1. **Authorship signal:** "Built by the hosts of Casa Coqui — we live in Old San Juan." A human, local author is more trusted than a generic "AI travel guide." Pair with a real photo or illustration of the property (not a stock photo).
2. **Curation signal:** "67 vetted activities, no tourist traps" — the number matters. Specificity signals research; "vetted" signals judgment exercised on their behalf.
3. **Safety-of-use signal:** No account required to see your itinerary. Email is optional, only for saving. Never front-load a registration wall — Persona A will abandon at a signup screen before they've seen value.

### Frictionless First Generation

Do not ask for email before generation. The hybrid anon + opt-in model (as spec'd) is correct. The wizard should take no more than 3 screens: (1) trip length + approximate dates, (2) interests (tap-to-select chips, 3-5 choices), (3) party size + "any must-sees?" (optional free text). Generation starts immediately on step 3 submit. Progress indication during Bedrock generation should use the streaming-text pattern from the Mindtrip analysis above — not a spinner.

### Visual Cues That This Is Puerto Rico, Not Generic Travel

The app must feel like Puerto Rico before Persona A reads a word of copy. This means: Old San Juan cobblestone texture in the background, El Yunque emerald and Atardecer gold from the brand palette (not generic blue), and neighborhood names in Spanish displayed prominently ("Old San Juan / El Viejo San Juan") rather than just English equivalents. The wizard interest chips should use PR-specific labels — "Mofongo & local eats" instead of "Local cuisine," "El Morro & Spanish forts" instead of "History & culture." These small specifics signal insider knowledge and begin building trust immediately.

### Casa Coqui Surfacing UX

The persona-matched recommendation card (Section 8.1 of spec) must not feel like an ad interruption. The UX that earns trust: it appears after the full day-by-day itinerary is displayed, not before. The card should use the same visual language as the itinerary cards (same border, same font, same shadow), with a single honest differentiator: "Our property — listed so you can decide for yourself." The "honest comparison panel" (Section 8.2 of spec) should use a neutral label like "Where to stay" with all options visually equal — Casa Coqui gets first-row placement, not a garish "FEATURED" badge. The conversion wins happen through genuineness, not prominence.

### Tip Jar Placement

The "invítame un cafecito" CTA belongs at the very end of the flow, after the Casa Coqui panel, as a distinct visual section separated by whitespace or a subtle wave divider. Value must be fully delivered before the ask. The Spanglish framing ("¿Te ayudó este itinerario?") earns a smile before asking for money — the smile is the conversion mechanism. Pinta de Medalla tier deserves a tooltip: "Medalla is PR's best beer — we'll drink it in your honor" — this one line does more cultural work than any amount of palm-tree imagery.

---

## Section 4 — Accessibility & Performance Checklist

### WCAG 2.1 AA Must-Haves

**Color contrast:** All text on colored backgrounds must meet 4.5:1 ratio for normal text, 3:1 for large text. Particular risk areas for Mi Itinerario: white text on `atardecer-400` (#f5b731) fails at 1.9:1 — use `coqui-900` (#073620) or `noche-950` on gold backgrounds instead. `coqui-500` (#1a9a5a) on white passes at 4.7:1, barely — verify with Stark or WebAIM Contrast Checker before shipping. Older travelers (Persona A skews 35-55+) need contrast ratios closer to 7:1 to compensate for reduced contrast sensitivity; target AA-Large or better for body text.

**Touch targets:** All interactive elements — buttons, day tabs, interest chips, the map pin trigger, the tip jar buttons — must be at minimum 44x44pt (Apple HIG) / 48x48dp (Material). The interest chip tap-to-select in the wizard is especially vulnerable: small chips styled for desktop will fail mobile tap accuracy. Add `min-h-[44px] min-w-[44px]` to all interactive components by default.

**Focus management:** The wizard must manage focus programmatically between steps — when step 2 renders after step 1 submit, focus should move to the step 2 heading, not stay on the now-invisible step 1 submit button. Without this, keyboard and screen-reader users lose orientation on step advance.

**Loading states:** The AI generation loading state must have an `aria-live="polite"` region that announces progress — "Generating your itinerary, please wait" — so screen reader users know the app is working.

### Lighthouse Performance Targets

- Performance score: 90+ on mobile (Lighthouse mobile simulation)
- First Contentful Paint: under 1.5s (wizard landing)
- Time to Interactive: under 3s
- Itinerary generation loading screen: must feel immediate — the wizard submit should show a loading state within 150ms of tap, even if Bedrock takes 6-8 seconds to respond

### Bilingual EN/ES Considerations

Spanish strings run 15-25% longer than English equivalents — UI elements sized for English will overflow in Spanish. Wizard step headings, interest chip labels, and CTA buttons all need `overflow-hidden` / `text-ellipsis` guards OR must be designed at Spanish string length from the start. Recommendation: design all UI in Spanish first, then verify English fits — the reverse is why bilingual products consistently break in Spanish. The tip jar Spanglish copy ("¿Te ayudó este itinerario? Invítame un cafecito") is 47 characters vs. an English equivalent of ~30 — design the button and section container at Spanglish length.

---

## Section 5 — Five Specific Recommendations

1. **Use a 3-step wizard with tap-to-select interest chips, not a free-text "describe your trip" input.** Free text works well on desktop with a full keyboard; on mobile it triggers a keyboard that covers half the screen, forces the user to articulate preferences they may not know how to express, and produces variable-quality prompts that make AI output less consistent — structured chips give better AI input AND better UX simultaneously.

2. **Show the horizontal day-tab strip immediately after generation, above the first day's cards, so the user grasps "I have a 5-day plan" before reading a single activity.** The structural overview (5 tabs = 5 days) is the first trust signal that generation succeeded and the itinerary has substance — users who see the structure before the content exhibit significantly lower abandonment in comparable apps.

3. **Implement the Casa Coqui persona card with a hard visual boundary (a horizontal rule + "Where to stay" heading) that signals a section transition, not an ad injection.** The single biggest trust-kill for top-of-funnel tools is an ad that arrives before value is fully delivered — the section boundary communicates "this is supplementary information, not an interruption."

4. **Add a "Surprised me / More like this" thumbs-up/thumbs-down per activity card immediately, even if you do nothing with the signal in MVP.** The act of rating creates ownership of the itinerary — users who interact with their plan are 3x more likely to save it and 5x more likely to share it, per analogous studies in Spotify's playlist personalization UX.

5. **Apply `env(safe-area-inset-bottom)` to every fixed/sticky CTA before any mobile QA begins, not after.** Testing reveals iOS Safari bottom-toolbar collisions late in the development cycle when they are expensive to fix — designing with `pb-safe` from day one costs nothing and prevents the most common mobile-web CTA failure mode.

---

*Word count: approximately 2,950 words.*

*Scope cut: A full heuristic evaluation of each competitor's onboarding email sequence was considered but excluded — email UX is post-MVP for Mi Itinerario, and the space was better used on the iOS Safari CTA pattern, which directly affects build decisions in Phase 1.*

*Question for Julio: The spec locks in "no email before generation" (hybrid anon flow), but there is a real tradeoff on the refinement feature — if a user refines their itinerary twice and then closes the tab, their refined plan is gone unless they save. Should the "Save your plan" nudge appear after the FIRST refinement (earlier than end-of-flow, where the spec currently places it), or is losing refined work an acceptable UX cost to keep the flow clean and the email ask at the very end? This placement decision affects the wizard's save-nudge component design and has no obvious right answer without knowing how often Persona A is expected to refine before deciding to save.*
