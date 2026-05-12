# Mi Itinerario — Visual Identity & Design Direction
**Agent:** UX E2 — Visual Identity & Design Direction Lead
**Date:** 2026-05-11
**Status:** Draft — for Julio review

---

## Section 1 — Brand Mood & Positioning

### Five Mood Words
**Warm. Knowing. Unhurried. Grounded. Inviting.**

Not the frothy excitement of a travel influencer. Not the clinical precision of TripAdvisor. Mi Itinerario feels like getting a text from a friend who actually lives in San Juan: "Trust me, skip Señor Frog's. Here's what we're doing instead." It carries the confidence of someone who has eaten at that spot a hundred times and knows exactly which table to ask for.

### What It Is Not
- Not corporate-travel-blue (United Airlines, Booking.com, Google Flights palette)
- Not generic-tropical-stock-photo (hammock silhouettes, saturated turquoise lagoons, coconut emojis)
- Not Instagram-influencer-glossy (high-contrast filters, perfect-body beach shots, #GoldenHour used ironically)
- Not aggressive-conversion-dark-pattern (countdown timers, "12 people are looking at this", fake urgency)
- Not theme-park-PR (El Yunque as backdrop for zipline branding, piña colada clipart)

### Sub-Brand Framing
Mi Itinerario is a younger sibling to Casa Coqui, not a stranger. Casa Coqui is the warm host who has already taken care of you. Mi Itinerario is what Casa Coqui gives guests before they arrive: the local knowledge, typed out into a plan. The visual language should feel continuous — same color family, same editorial restraint, same anti-corporate instincts — but given more room to breathe and more space for information density, because itinerary planning is an active task, not a relaxing experience.

Think: Casa Coqui is the living room after check-in. Mi Itinerario is the handwritten welcome note left on the counter.

### Reference Brands (visual feeling, not exact copy)
1. **Eater's city guides** — editorial hierarchy, bold type, no-nonsense recommendation voice, photography that's clearly taken by someone who ate there
2. **Field Mag** — unhurried editorial pacing, warm earth tones, generous whitespace, photography that makes you feel the texture of the place
3. **Airbnb's "Experiences" landing pages (2019-2022 era)** — the version before they over-simplified everything; local guide pages with real neighborhood photography, not stock imagery
4. **Cereal magazine** — quiet confidence, typographic restraint, destinations shown through close detail rather than panorama, color palettes pulled from the location itself

---

## Section 2 — Three Distinct Visual Directions

---

### Direction A: "Atardecer" (Golden Hour Intelligence)

**Emoji:** ☀️

**Mood:** The warm knowledge of late afternoon. The moment when the light goes amber and everything looks exactly right and you finally feel like you understand a place. Unhurried but purposeful. Information-rich without feeling busy. This is the direction of the host who has made the coffee and laid out the books before you even knew you wanted them.

**Color Palette** (extends Casa Coqui, does not replace):
- `#F8CB5C` — atardecer-300, "Rincón Amber" — primary heading accent, hero warmth
- `#1A9A5A` — coqui-500, "Canopy Green" — primary action buttons, links
- `#FDFBF7` — cafe-50, "Leche de Coco" — page background, card backgrounds
- `#F2E4CC` — cafe-200, "Piedra Caliza" — section dividers, subtle borders, chip backgrounds
- `#073620` — coqui-900, "Bosque Profundo" — body text, high-contrast headings
- `#26A9B5` — caribe-500, "Mar Caribe" — interactive highlights, tag badges, day-number indicators

**Typography Pairing:**
- **Display / H1:** `Playfair Display` (Google Fonts) — warm, editorial serif with slight ink-trap character. Heavier alternative to DM Serif Display; works better at the medium heading sizes (24–36px) that an itinerary UI needs. Weight 700 for hero, 400 for subheadings.
- **Body / UI:** `DM Sans` (already in Casa Coqui stack) — no change; continuity is the point. Weight 400 body, 500 labels, 600 buttons.
- **Accent / Dates / Times:** `DM Mono` (same family) — for time-of-day stamps, day numbers, price tiers. Adds a quiet editorial precision without feeling developer-coded.

**Photo Treatment:**
Tightly cropped details at golden hour. The condensation on a cold Medalla. The painted tile at Café Cuatro Sombras. A hand reaching for a tostada. Natural light only, warm bias. No wide panoramas — the photo earns its space by showing you *what it feels like* to be there, not *where it is on a map*. No filters or presets; the warmth comes from the light in the original image.

**Component Vibe:**
`rounded-2xl` cards with `shadow-brand-md` (the existing Casa Coqui shadow token). Generous vertical padding — 24–32px internal on day cards. Subtle `cafe-200` borders (1px, not bold dividers). Day numbers large and in `caribe-500`. Chip/tag components use `cafe-200` backgrounds with `coqui-900` text. CTA buttons are `coqui-500` fill with white text, or `atardecer-400` fill for the primary Casa Coqui surfacing card.

**Best For:** Persona A — the first-time North American tourist couple. This palette and pacing feels premium and trustworthy without being intimidating. It says: "Someone made this for you, and they know what they're doing."

---

### Direction B: "Mercado" (Market Day Energy)

**Emoji:** 🌶

**Mood:** Saturday morning at La Placita. Color, noise, confidence, movement. This direction leans into Puerto Rico's vibrancy without resorting to neon or cliché. It is bold but edited — the boldness of a handpainted mercado sign, not a fast food logo. It prioritizes scanability and delight over restraint.

**Color Palette:**
- `#FF7A4D` — flamboyan-400, "Flamboyan" — primary accent, category badges, hero background blocks
- `#137A47` — coqui-600, "Canopy Verde" — primary action color (inherited from Casa Coqui)
- `#F5B731` — atardecer-400, "Oro" — secondary highlights, star ratings, featured markers
- `#FFFFFF` — pure white — card backgrounds (break from cafe warmth; more market-stall awning feel)
- `#073620` — coqui-900, "Tierra" — all body text
- `#42C5CF` — caribe-400, "Agua Caribe" — interactive states, hover, selected day tabs

**Typography Pairing:**
- **Display:** `Syne` (Google Fonts) — geometric, slightly quirky, confident. Used at large sizes for neighborhood names and day headers. Weight 800 for impact.
- **Body:** `Inter` — maximally legible at small sizes, works well in data-dense itinerary rows. Not as warm as DM Sans but the color palette compensates.
- **Labels / Tags:** `Syne` weight 600 at small sizes — maintains personality through the whole scale.

**Photo Treatment:**
High saturation, mid-day light (not golden hour). Overhead shots of food, street scenes with people, color in the frame. Editorial crop but not precious about it. This direction can tolerate slightly busier photos because the surrounding UI is confident enough to hold them.

**Component Vibe:**
Tighter border radius (`rounded-xl`, 12px, not 16px). Category chips use `flamboyan-400` backgrounds. Day tab navigation is horizontal scrolling bar at top, bold active state with thick bottom border in `coqui-600`. Less whitespace between items — information density is a feature, not a bug, for the traveler actively building their plan. Cards have subtle left-border accent (4px, `flamboyan-400`) to distinguish activity type.

**Best For:** Appeals most to Persona B (the diaspora traveler looking for food-forward, culturally confident content) who are NOT the MVP target — but this direction would also work well for travelers who feel like Direction A is "too subtle" and want the energy of the island front and center. Risk: may read as "too much" for Persona A's first-time-tourist anxiety.

---

### Direction C: "Arquitectura" (Old San Juan Stone)

**Emoji:** 🏛

**Mood:** The blue cobblestones of Calle del Cristo. The peeling pastel of a 300-year-old building. The Old San Juan that is genuinely historic, not themed. This direction is the most refined — typographically tight, photographically editorial, with a color palette that says "I know what I'm doing" in a quiet voice. It references the print design tradition of serious travel magazines (Monocle, Cereal) more than digital-first products.

**Color Palette:**
- `#224B57` — caribe-900, "Piedra del Morro" — primary heading color, hero backgrounds
- `#D6F6F7` — caribe-100, "Brisa" — section background tints, card surface
- `#F8CB5C` — atardecer-300, "Sol de Tarde" — sole warm accent; used sparingly for highlights only
- `#FDFBF7` — cafe-50, "Papel" — page background (same as parent brand, continuity)
- `#073620` — coqui-900, "Tinta" — all body text
- `#137A47` — coqui-600, "Verja" — action buttons only; green recedes from hero role here

**Typography Pairing:**
- **Display:** `Cormorant Garamond` (Google Fonts) — high-contrast serif, genuinely editorial, with the kind of thin strokes that look excellent at 48px on a hero. Weight 600 for display, 400 for subheadings. Unmistakably print-influenced.
- **Body:** `Source Serif 4` (Google Fonts) — readable serif for body text (unusual choice for a UI but appropriate for this direction). Creates a magazine-reading experience.
- **UI Labels / Buttons / Times:** `DM Sans` weight 500 — the functional layer stays humanist sans; the editorial layer goes serif. Clear hierarchy.

**Photo Treatment:**
Documentary style. Natural light without golden-hour bias — this direction works in morning gray, afternoon overcast, all of it. Tightly cropped architecture details. Stone textures, weathered paint, wrought iron. Black-and-white is acceptable for historical/neighborhood context images. The photography does not perform happiness.

**Component Vibe:**
Minimal border radius (`rounded-md`, 6px) — respects the architectural reference. Generous margins. Hairline borders (`border border-caribe-100`). Typography does the heavy lifting; components recede into the background. Day cards are essentially typographic — the photo is secondary or absent. Price tiers shown as `$` glyphs in a constrained monospaced style.

**Best For:** Persona C (digital nomad, long-stayer, aesthetic traveler) who is also not the MVP target. This direction would read as cold to Persona A who needs warmth and trust signals. Its restraint could feel like the product doesn't care about them. Strongest as a future direction if Mi Itinerario evolves toward a premium, curated travel brand in its own right.

---

## Section 3 — Component Style Sketches (Direction A: "Atardecer")

### 1. Hero Section — `/plan` Landing Page

Full-bleed background in `cafe-50` (warm off-white, not pure white). In the top-right quadrant, a subtle radial gradient bleed of `atardecer-200` at about 6% opacity — the golden hour tint, felt rather than seen. No photo in the hero; the warmth comes from typography and color alone (fast LCP, no render-blocking image).

Centered layout on mobile. H1 in `Playfair Display` 700, 36px on mobile / 56px on desktop, `coqui-900` text: "Your Puerto Rico, day by day." Subhead in `DM Sans` 400 16px, `cafe-700`: "Tell us about your trip. We'll build your itinerary — vetted, personal, free." Below, a single primary CTA button: `bg-coqui-500 text-white rounded-2xl px-8 py-4` — "Build my itinerary". Generous vertical rhythm: 80px between headline stack and button on mobile.

Small credibility line below the CTA in `DM Mono` 12px `cafe-600`: "67 vetted San Juan activities · powered by local knowledge". Adds the brand's confident-but-not-corporate signal.

### 2. Persona Wizard Step — Question + Answer Chips

Full-screen step (one question per screen on mobile). Question in `Playfair Display` 700 28px `coqui-900`, centered, with an optional small `caribe-500` day-count badge in the upper right showing progress ("Step 2 of 4").

Below the question, a free-flowing chip grid (flex-wrap). Each chip: `rounded-full bg-cafe-200 border border-cafe-300 text-coqui-900 font-dm-sans font-500 text-sm px-4 py-2`. Selected state: `bg-coqui-500 border-coqui-500 text-white`. Touch target minimum 44px height — mobile-first critical. Chips do not overflow their container; they wrap naturally. No multi-column grid layout that requires the user to read left-right on mobile.

"Continue" button fixed to bottom of viewport on mobile: full-width, `bg-coqui-500`, disabled state `bg-cafe-300 text-cafe-600` until at least one chip is selected.

### 3. Day Card — Itinerary View Activity Entry

Card: `rounded-2xl shadow-brand-md bg-white border border-cafe-100`. Internal padding 20px. Left side: a 48x48 image thumbnail, `rounded-xl`, of the activity — shows what it looks like, not a map pin. Right side: activity name in `DM Sans` 600 16px `coqui-900`. Below: time stamp in `DM Mono` 400 13px `caribe-600` ("9:00 AM — ~2 hrs"). Below that: one-line "why" blurb in `DM Sans` 400 13px `cafe-800` — pulled from the activity's `why_it_matters` field. Price tier in `DM Mono` 12px `cafe-500` bottom-right.

On mobile, card is full-width with 16px horizontal margin. The time is the most glanceable element — `DM Mono` + `caribe-500` color ensures the schedule column reads cleanly when scanning down a list of 4-5 activities for a day.

Accordion behavior: tap to expand shows the full description + photo + reservation note. The collapsed state shows only the essentials — this is an itinerary, not a review site.

### 4. Casa Coqui Surfacing Card — Persona-Match Recommendation

This card needs to feel like a natural handoff, not an ad. Distinct visual treatment to signal "this is from us, not a recommendation algorithm."

`rounded-2xl bg-atardecer-50 border border-atardecer-200 shadow-brand-lg` — warm gold tint differentiates from the white activity cards. Internal: 24px padding. Top: small `DM Mono` 11px `atardecer-700` label: "WHERE YOUR HOST RECOMMENDS". Below: Casa Coqui wordmark in `Playfair Display` 700 22px `coqui-900` (matches the parent brand's display font). One-liner in `DM Sans` 400 14px `cafe-800`: "Old San Juan, 5-min walk to El Morro · Hosted by Julio". Availability line in `DM Mono` 13px `caribe-700`: "Your dates: Aug 12–18". Full-width CTA button below: `bg-atardecer-400 text-coqui-900 rounded-xl font-600` — "Check availability" — the gold button intentionally breaks from the green buttons everywhere else, signaling this is the booking moment.

Mobile: card appears after the last day in the itinerary scroll, full-width, sticky-scrollable. Does not interrupt the day-by-day planning flow.

### 5. Tip Jar — Cafecito Buttons

Light-touch section, not a sales moment. Container: `bg-cafe-100 rounded-2xl px-6 py-8` with subtle top `border-t border-cafe-200`. Heading in `Playfair Display` 400 italic 20px `coqui-900`: "¿Te ayudó este itinerario?" Subhead in `DM Sans` 400 14px `cafe-700`: "Invítame un cafecito — every dollar keeps this free for the next traveler."

Three buttons in a row on mobile (or wrapping if narrow): each `rounded-full border border-cafe-300 bg-white text-coqui-900 font-dm-sans font-500 text-sm px-4 py-3`. Icon prefix: small coffee cup emoji (acceptable here — it's a fun context). Labels: "☕ Cafecito $1" / "☕☕ Café con leche $3" / "☕☕☕ Pinta de Medalla $5". The Medalla label is the inside joke that Persona B and C will share and screenshot. Persona A will google "Medalla" — and that is correct behavior.

Hover state: `bg-atardecer-100 border-atardecer-300`. No aggressive animation. The section recedes visually — it should feel optional, not mandatory.

---

## Section 4 — Casa Coqui Brand Coherence Check

### 3 Visual Elements Mi Itinerario SHARES with Casa Coqui

1. **Color family continuity.** `coqui-500` (`#1A9A5A`) remains the primary action green. `cafe-50` (`#FDFBF7`) stays the background base. `caribe-500` appears as the accent wherever interactive states need to breathe. The parent brand's palette shows up immediately — a returning Casa Coqui guest arriving at `/plan` will recognize the DNA.

2. **DM Sans as the functional body typeface.** Even in Direction A where `Playfair Display` handles editorial display moments, `DM Sans` is the workhorse for all UI text, labels, buttons, and body copy. A single typeface used consistently across both products reduces cognitive friction and reinforces the shared-family feeling.

3. **Shadow and radius token inheritance.** `shadow-brand-md` and `rounded-2xl` are used directly from the Casa Coqui Tailwind config for cards. This means components that migrate across products (a Casa Coqui booking card embedded in the Mi Itinerario surfacing module) will match visually without extra work.

### 3 Visual Elements Mi Itinerario DIFFERENTIATES from Casa Coqui

1. **Editorial serif for display.** Casa Coqui uses `DM Serif Display` only for the brand name itself, very sparingly. Mi Itinerario promotes `Playfair Display` to a primary display role — day-view headings, hero headline, wizard questions. This signals "information-forward product" vs "hospitality experience," which is the right distinction.

2. **Information density.** Casa Coqui's guest portal is designed for rest — generous whitespace, low-density screens, one call-to-action at a time. Mi Itinerario is a planning tool; users expect to see 4-5 activities per day, multiple days, comparison information. Tighter vertical rhythm on activity cards, scrollable day views, and horizontal tab navigation are appropriate here even though they would feel wrong in the guest portal.

3. **Atardecer gold as a primary surfacing color** (not just accent). In Casa Coqui, `atardecer-400` gold is an accent that punctuates — a highlight, a badge, a warm glow. In Mi Itinerario Direction A, it becomes the hero color for the Casa Coqui surfacing card and wizard-completion moments. This deliberate elevation of gold signals the conversion moment without being aggressive — and it naturally separates the "booking funnel" layer from the "planning tool" layer visually.

---

## Section 5 — Recommended Direction + Implementation Notes

### Recommended Direction: A — "Atardecer"

**Why A over B and C:**

Direction B (Mercado) is the most visually exciting and would delight Persona B and C — but the MVP serves Persona A, who is anxious, first-time, English-first, and needs warmth and trust before delight. The flamboyan accent in B can read as aggressive or "touristy" to that audience. Direction B would also compete visually with the Casa Coqui surfacing card instead of framing it.

Direction C (Arquitectura) is the most refined and would produce a genuinely beautiful product — but its restraint reads as cold to Persona A, and its editorial serif-heavy approach requires a level of photography investment (real, documentary-quality imagery of activities) that is premature for an MVP with 67 seeded items and no photo production budget.

Direction A occupies the correct middle register: warm enough to earn trust from a first-timer, editorially confident enough to feel curated, and lightweight enough to ship cleanly. It extends the Casa Coqui palette without friction. The information density is appropriate for the planning task without overwhelming. And it gives the Casa Coqui surfacing card (`atardecer-50` background + gold CTA) a natural home that does not feel like advertising.

### 5 Most Important Tailwind / shadcn Tokens to Customize First

When initializing the Mi Itinerario `/plan` route, these are the five customizations that will establish the visual direction before a single component is designed:

1. **`--background: #FDFBF7`** (`cafe-50`) — set as the CSS custom property for shadcn's background token in the plan layout. Every component that uses `bg-background` inherits the warm off-white immediately.

2. **`--primary: #1A9A5A`** (`coqui-500`) — the shadcn primary color token for buttons, links, focus rings. Maps directly from Casa Coqui's action green. Do not redefine; just point the shadcn token at the existing Tailwind color.

3. **`font-display: ['Playfair Display', ...]`** — extend the `fontFamily.display` entry in the Mi Itinerario Tailwind config (or extend it in the global config if this is one repo). One new `font-display` class unlocks the editorial serif at every heading level.

4. **`rounded-2xl` as the default card radius** — do not let shadcn default to its own border-radius tokens for cards. Explicitly set `rounded-2xl` (16px) on Card components from the start. This is the visual signature of the Casa Coqui brand family and should be non-negotiable.

5. **`--accent: #F8CB5C`** (`atardecer-300`) — the shadcn accent token, used for wizard-step progress indicators, selected chip state highlights, and the hero radial glow. Setting this early means all interactive feedback states carry the golden-hour warmth automatically.

---

*Word count: ~1,950 words. Prepared by UX Agent E2 — Visual Identity & Design Direction Lead.*
