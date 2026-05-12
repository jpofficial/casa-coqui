# Mi Itinerario — Plan 3: Casa Coqui Funnel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the booking-conversion layer to the itinerary view — a persona-matched Casa Coqui recommendation card (when the trip fits) plus an always-visible honest "Where to Stay" panel with neutral neighborhood alternatives + the Spanglish tip jar. This is the revenue path: turn "I have a plan" → "I'll stay at Casa Coqui."

**Architecture:** Pure frontend addition to the existing `[plan_id]/page.js` route. Two new components inserted after the day stack, before the footer. Persona-fit logic runs server-side in the page (based on `plan.traveler_type` + `plan.num_days`). Casa Coqui card links into the existing Casa Coqui booking flow at `casa-coqui.cc/bookings` (or wherever the host wants — configurable env var). Tip jar uses Buy Me a Coffee external link (no backend integration in MVP).

**Tech Stack:** Same as Plan 1 — Next.js 14 App Router, Tailwind, no new dependencies. No AWS infra changes.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pr-itinerary-app-design.md` §8 (Casa Coqui funnel), §9 (tip jar)

**Dependencies:** Plan 1 ✅ end-to-end. No Plan 2 dependency.

**Estimated duration:** 1-2 sessions of focused work (6 tasks).

---

## File Structure (Plan 3 deltas)

```
casa-coqui/
├── app/puerto-rico-itinerary/
│   ├── [plan_id]/page.js                       [MODIFY] insert funnel components
│   └── components/
│       ├── CasaCoquiCard.js                    [NEW] persona-matched lodging card
│       ├── WhereToStayPanel.js                 [NEW] comparison panel
│       └── TipJar.js                           [NEW] Spanglish BMaC component
├── lib/itinerary/
│   └── persona-fit.js                          [NEW] pure logic: does Casa Coqui fit this plan?
└── .env.local                                  [MODIFY] CASA_COQUI_BOOKING_URL, BMC_USERNAME
```

---

## Task 1: persona-fit logic (pure function + tests)

**Files:**
- Create: `lib/itinerary/persona-fit.js`
- Create: `lib/__tests__/persona-fit.test.js`

- [ ] **Step 1: Write the persona-fit function**

Create `lib/itinerary/persona-fit.js`:

```javascript
/**
 * Determines whether Casa Coqui is a good fit for a given plan.
 * Returns { fit: boolean, reason: string }.
 *
 * Rules:
 * - Casa Coqui has 2 units, each sleeps up to 4 guests (8 total)
 * - Strong fit: couple or family (2-4) on 3-10 day trips, OSJ-focused
 * - Weak fit: large groups (>4 per unit), solo budget travelers, 1-2 day trips
 * - Universal: every plan still gets the "Where to Stay" panel
 */
export function casaCoquiFits(plan) {
  const numDays = plan?.num_days || (plan?.days || []).length || 0;
  const travelerType = plan?.traveler_type;

  // Trip too short — they probably already have lodging
  if (numDays < 2) {
    return { fit: false, reason: 'short_trip' };
  }
  // Trip too long — multi-week stays need different lodging
  if (numDays > 14) {
    return { fit: false, reason: 'long_trip' };
  }
  // Friends group of 6+ won't fit our 2-unit capacity
  if (travelerType === 'friends') {
    // Assume "friends" means 4+ people based on wizard wording
    return { fit: true, reason: 'friends_might_fit_split_across_units' };
  }
  if (travelerType === 'family') {
    return { fit: true, reason: 'family_fits' };
  }
  if (travelerType === 'couple') {
    return { fit: true, reason: 'couple_fits' };
  }
  if (travelerType === 'solo') {
    return { fit: false, reason: 'solo_overprovisioned' };
  }
  // Default: show it
  return { fit: true, reason: 'default_show' };
}
```

- [ ] **Step 2: Write the tests**

Create `lib/__tests__/persona-fit.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casaCoquiFits } from '../itinerary/persona-fit.js';

test('couple on 5-day trip — fits', () => {
  const r = casaCoquiFits({ traveler_type: 'couple', num_days: 5 });
  assert.equal(r.fit, true);
});

test('family on 7-day trip — fits', () => {
  const r = casaCoquiFits({ traveler_type: 'family', num_days: 7 });
  assert.equal(r.fit, true);
});

test('solo traveler — does NOT fit (2-unit minimum)', () => {
  const r = casaCoquiFits({ traveler_type: 'solo', num_days: 5 });
  assert.equal(r.fit, false);
  assert.equal(r.reason, 'solo_overprovisioned');
});

test('1-day trip — does NOT fit (too short)', () => {
  const r = casaCoquiFits({ traveler_type: 'couple', num_days: 1 });
  assert.equal(r.fit, false);
});

test('15-day trip — does NOT fit (too long)', () => {
  const r = casaCoquiFits({ traveler_type: 'couple', num_days: 15 });
  assert.equal(r.fit, false);
});

test('derives num_days from days array if missing', () => {
  const r = casaCoquiFits({
    traveler_type: 'couple',
    days: [{ day_num: 1 }, { day_num: 2 }, { day_num: 3 }],
  });
  assert.equal(r.fit, true);
});
```

- [ ] **Step 3: Verify**

```bash
npm test
```

Expected: 6 new tests passing (plus existing ~52).

- [ ] **Step 4: Commit**

```bash
git add lib/itinerary/persona-fit.js lib/__tests__/persona-fit.test.js
git commit -m "feat(plan): persona-fit logic for Casa Coqui recommendation"
```

---

## Task 2: CasaCoquiCard component

**Files:**
- Create: `app/puerto-rico-itinerary/components/CasaCoquiCard.js`

- [ ] **Step 1: Write the component**

```javascript
'use client';
import Link from 'next/link';

export default function CasaCoquiCard({ bookingUrl }) {
  return (
    <section className="mx-5 my-8 overflow-hidden rounded-2xl border border-atardecer-200 bg-atardecer-50 shadow-[0_10px_30px_-4px_rgba(168,95,12,0.18)] md:mx-0">
      {/* Eyebrow strip */}
      <div className="border-b border-atardecer-200 px-6 py-3 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-atardecer-700">
        ★ Where your host recommends
      </div>

      <div className="px-6 py-7 text-center lg:py-10">
        {/* Wordmark */}
        <h3 className="mb-2 font-display text-3xl font-bold leading-none text-coqui-900 lg:text-4xl">
          Casa Coqui
        </h3>

        {/* Meta description */}
        <p className="mx-auto mb-3 max-w-md text-sm leading-relaxed text-cafe-800 lg:text-base">
          San Juan · 2 units · sleeps up to 8 · hosted by Julio.
          <br />
          Walkable to Old San Juan, beach access, fast WiFi.
        </p>

        {/* Trust microcopy */}
        <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.08em] text-cafe-600">
          Built by your host — same person who curated this itinerary
        </p>

        {/* CTA — gold breaks pattern from green CTAs elsewhere */}
        <Link
          href={bookingUrl}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-atardecer-400 px-8 py-4 font-semibold text-coqui-900 shadow-[0_6px_14px_-3px_rgba(245,183,49,0.5)] transition-transform hover:scale-[1.02] lg:px-10 lg:py-5 lg:text-lg"
        >
          Check availability →
        </Link>

        {/* Sub-link for guests who don't want full landing */}
        <p className="mt-5 text-xs">
          <Link href={bookingUrl} className="text-atardecer-700 underline decoration-atardecer-300 underline-offset-4 hover:text-coqui-900">
            See photos, amenities, and reviews
          </Link>
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/puerto-rico-itinerary/components/CasaCoquiCard.js
git commit -m "feat(plan): CasaCoquiCard persona-matched recommendation"
```

---

## Task 3: WhereToStayPanel component (honest comparison)

**Files:**
- Create: `app/puerto-rico-itinerary/components/WhereToStayPanel.js`

- [ ] **Step 1: Write the component**

```javascript
'use client';
import Link from 'next/link';
import CasaCoquiCard from './CasaCoquiCard';

const NEIGHBORHOODS = [
  {
    name: 'Old San Juan',
    pitch: 'Walkable cobblestones · 5 min to El Morro · historic, lively, no parking',
    price: '$$',
    type: 'mix: boutique hotels + Airbnbs',
    is_casa_coqui: true,
  },
  {
    name: 'Condado',
    pitch: 'Beachfront hotels · upscale dining · 10 min Uber to OSJ',
    price: '$$$',
    type: 'big hotels (Marriott, Vanderbilt, La Concha)',
  },
  {
    name: 'Isla Verde',
    pitch: 'Resort feel · long beach · 15 min Uber to OSJ · airport-adjacent',
    price: '$$$$',
    type: 'resorts (Ritz, Fairmont)',
  },
  {
    name: 'Santurce',
    pitch: 'Art district · best restaurants · cheaper · 10 min Uber to OSJ',
    price: '$$',
    type: 'boutique + Airbnbs',
  },
];

export default function WhereToStayPanel({ bookingUrl, includeCard = true }) {
  return (
    <section className="mt-12">
      {includeCard && <CasaCoquiCard bookingUrl={bookingUrl} />}

      <div className="mx-5 mb-8 md:mx-0">
        <h2 className="mb-1 text-center font-display text-2xl font-bold text-coqui-900 lg:text-3xl">
          Where to stay in San Juan
        </h2>
        <p className="mb-6 text-center text-sm text-cafe-700 lg:text-base">
          Honest about it: here&apos;s how Casa Coqui&apos;s neighborhood compares to the alternatives.
        </p>

        <div className="space-y-3">
          {NEIGHBORHOODS.map((n) => (
            <div
              key={n.name}
              className={`rounded-2xl border p-4 ${
                n.is_casa_coqui
                  ? 'border-atardecer-300 bg-atardecer-50/50'
                  : 'border-cafe-100 bg-white'
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="font-display text-lg font-semibold text-coqui-900">
                  {n.name}
                  {n.is_casa_coqui && (
                    <span className="ml-2 inline-block rounded-full bg-atardecer-300 px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-[0.08em] text-coqui-900">
                      ↑ Casa Coqui
                    </span>
                  )}
                </h3>
                <span className="font-mono text-sm text-cafe-700">{n.price}</span>
              </div>
              <p className="text-sm text-cafe-800">{n.pitch}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-cafe-600">
                {n.type}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/puerto-rico-itinerary/components/WhereToStayPanel.js
git commit -m "feat(plan): WhereToStayPanel honest neighborhood comparison"
```

---

## Task 4: TipJar component (Buy Me a Coffee)

**Files:**
- Create: `app/puerto-rico-itinerary/components/TipJar.js`

- [ ] **Step 1: Write the component**

```javascript
'use client';

const TIERS = [
  { emoji: '☕', label: 'Cafecito', amount: 1 },
  { emoji: '☕☕', label: 'Café con leche', amount: 3 },
  { emoji: '☕☕☕', label: 'Pinta de Medalla', amount: 5 },
];

export default function TipJar({ bmcUsername }) {
  if (!bmcUsername) return null;
  const baseUrl = `https://www.buymeacoffee.com/${bmcUsername}`;

  return (
    <section className="mx-5 my-10 rounded-2xl border-t border-cafe-200 bg-cafe-100 px-6 py-8 text-center md:mx-0">
      <h3 className="mb-2 font-display text-xl italic text-coqui-900 lg:text-2xl">
        ¿Te ayudó este itinerario?
      </h3>
      <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-cafe-700 lg:text-base">
        Invítame un cafecito — every dollar helps me keep this free for the next traveler.
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {TIERS.map((t) => (
          <a
            key={t.label}
            href={`${baseUrl}?amount=${t.amount}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-cafe-300 bg-white px-4 py-2.5 text-sm font-medium text-coqui-900 transition-colors hover:bg-atardecer-100 hover:border-atardecer-300"
          >
            <span>{t.emoji}</span>
            <span>{t.label}</span>
            <span className="font-mono text-xs text-cafe-600">${t.amount}</span>
          </a>
        ))}
      </div>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.08em] text-cafe-600">
        100% goes toward keeping this app free + ad-free
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/puerto-rico-itinerary/components/TipJar.js
git commit -m "feat(plan): TipJar Spanglish Buy Me a Coffee component"
```

---

## Task 5: Wire components into `[plan_id]/page.js`

**Files:**
- Modify: `app/puerto-rico-itinerary/[plan_id]/page.js`
- Modify: `.env.local` (add CASA_COQUI_BOOKING_URL + BMC_USERNAME)

- [ ] **Step 1: Update `.env.local`**

Add at end:

```
# Mi Itinerario — funnel
CASA_COQUI_BOOKING_URL=https://www.airbnb.com/rooms/<replace-with-real-listing-id>
NEXT_PUBLIC_BMC_USERNAME=julio-coqui
```

(Julio: replace `<replace-with-real-listing-id>` with the actual Airbnb listing URL or use `https://casa-coqui.cc/bookings` once that page exists. Update `julio-coqui` to whatever Buy Me a Coffee username gets reserved.)

- [ ] **Step 2: Update the page to insert components**

In `app/puerto-rico-itinerary/[plan_id]/page.js`, after the imports add:

```javascript
import WhereToStayPanel from '../components/WhereToStayPanel';
import TipJar from '../components/TipJar';
import { casaCoquiFits } from '@/lib/itinerary/persona-fit';
```

After the `{(plan.days || []).map(...)}` block and before the `<footer>`, insert:

```javascript
        {(() => {
          const { fit } = casaCoquiFits(plan);
          const bookingUrl = process.env.CASA_COQUI_BOOKING_URL || '/bookings';
          return (
            <WhereToStayPanel
              bookingUrl={bookingUrl}
              includeCard={fit}
            />
          );
        })()}

        <TipJar bmcUsername={process.env.NEXT_PUBLIC_BMC_USERNAME} />
```

- [ ] **Step 3: Build + visual check**

```bash
npm run build
```

Open `http://localhost:3000/puerto-rico-itinerary/<existing-plan-id>` — should now show:
1. Day cards (as before)
2. ★ Casa Coqui Card (if fits) with gold styling
3. Where to Stay neighborhood comparison
4. Tip Jar
5. Footer

- [ ] **Step 4: Commit**

```bash
git add app/puerto-rico-itinerary/[plan_id]/page.js
git commit -m "feat(plan): wire Casa Coqui card + Where-to-Stay + Tip Jar into itinerary view"
```

---

## Task 6: Conversion analytics + final QA

**Files:**
- Modify: `app/puerto-rico-itinerary/components/CasaCoquiCard.js` (add tracking attribute)
- Modify: `app/puerto-rico-itinerary/components/TipJar.js` (add tracking attribute)

- [ ] **Step 1: Add Vercel Analytics tracking**

Casa Coqui has Vercel Analytics. Add `data-event-name` attributes to the conversion buttons:

In `CasaCoquiCard.js`, modify the primary CTA Link:
```javascript
<Link
  href={bookingUrl}
  data-event-name="cc_card_check_availability"
  className="..."
>
```

In `TipJar.js`, modify each tier `<a>`:
```javascript
<a
  ...
  data-event-name={`tip_${t.label.toLowerCase().replace(/ /g, '_')}`}
>
```

- [ ] **Step 2: Manual QA — walk through full flow**

In your browser at `http://localhost:3000/puerto-rico-itinerary`:

1. Wizard with **couple, 5 days** → submit → land on itinerary page
2. Scroll to end — should see ★ Casa Coqui card + Where to Stay + Tip Jar
3. Click "Check availability" → opens booking URL in new tab (or same tab — your choice)
4. Click a tip tier → opens Buy Me a Coffee in new tab

Then wizard with **solo, 5 days**:
- Itinerary view should show Where to Stay panel WITHOUT the ★ Casa Coqui card (persona doesn't fit)
- Tip Jar still appears

Then wizard with **family, 7 days**:
- Casa Coqui card shows with family-fit branding
- Where to Stay panel below

- [ ] **Step 3: Mobile + desktop responsive check**

Resize browser to phone width (~400px) — all 3 components should stack cleanly. On desktop (>1024px), Casa Coqui card centered with max-width, neighborhoods stack vertically.

- [ ] **Step 4: Commit**

```bash
git add app/puerto-rico-itinerary/components/CasaCoquiCard.js app/puerto-rico-itinerary/components/TipJar.js
git commit -m "feat(plan): conversion tracking attributes on CC card + tip jar"
```

---

## Self-Review

**Spec coverage:**
- §8.1 (persona-matched recommendation when fit) → Tasks 1, 2, 5 ✅
- §8.2 (honest Where to Stay panel with alternatives) → Task 3 ✅
- §9 (Spanglish tip jar with Buy Me a Coffee) → Task 4 ✅
- Conversion tracking → Task 6 ✅

**Placeholder scan:** Just two intentional ones — `<replace-with-real-listing-id>` and `julio-coqui` BMC username, both flagged inline for Julio to fill.

**Type consistency:** All components take props matching what `[plan_id]/page.js` passes. `casaCoquiFits` returns `{ fit, reason }` consistently.

**Scope check:** Frontend-only (no AWS infra changes), single coherent feature (booking funnel), independently testable. ✅

---

## Execution Handoff

Plan 3 ready. Subagent-driven execution recommended.
