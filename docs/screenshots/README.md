# Screenshots — capture list

The root `README.md` has a **Screenshots** section with three placeholders that point at the
files below. Capture each screen, save it under this folder with the exact filename, then swap
the placeholder row in the README for the commented-out image row directly beneath it.

Use the **live site** (production data, your own admin login, and a real or seeded guest link)
so the screens look lived-in. Blur or crop anything personal (guest names, phone numbers, door
codes, WiFi passwords) before committing — the PNGs are public once pushed.

| # | File | Screen | Route | Viewport | Notes |
|---|------|--------|-------|----------|-------|
| 1 | `guest-portal-phone.png` | Guest portal home | `/g/<code>` | Phone — 390 × 844 (iPhone 14/15), 2× scale | Signed in as a guest with an **active** stay so the welcome header, check-in guide card, WiFi card and the live laundry status tile all render. Capture in the English locale. Optional second frame: `/g/<code>/laundry` to show the waitlist. |
| 2 | `admin-dashboard.png` | Host admin dashboard | `/admin` | Desktop — 1440 × 900, 2× scale (or a phone frame if you prefer: most host use is mobile) | Logged in as the **admin** role (not cohost — the cohost sees the trimmed ops view). Capture while at least one stay is active so the active-stays cards, laundry tile and monthly-revenue figure are populated (blur the revenue number if you'd rather not publish it). |
| 3 | `pricing-rate-calendar.png` | Pricing — rate calendar | `/admin/pricing/calendar` | Desktop — 1440 × 900, 2× scale | Select a unit and a month with recommendations applied so the calendar shows per-night rates and the advisor/chat panel has content. If you'd rather show the overview, `/admin/pricing` is the fallback. |

## How to capture

- **Browser dev tools**: toggle device emulation, set the viewport above, set device pixel ratio
  to 2, then "Capture screenshot" (Chrome: ⌘⇧P → *Capture screenshot*).
- **Playwright** (from the repo root, with `playwright` already in devDependencies):

  ```js
  // save as scripts/debug/screenshot.js (not committed) and run:
  //   node scripts/debug/screenshot.js <url> <out.png> [width] [height]
  const { chromium } = require('playwright');
  (async () => {
    const [url, out, w = 390, h = 844] = process.argv.slice(2);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: out });
    await browser.close();
  })();
  ```

  Authenticated screens need a logged-in session; the simplest path is to log in manually in a
  headed browser and use `page.context().storageState()` — or just use dev tools.

- Export as **PNG**, keep each file under ~500 KB (run through ImageOptim/Squoosh if needed).

## Then

1. Save the three PNGs here with the exact filenames above.
2. In `README.md`, delete the placeholder table row (the one with "_placeholder_") and uncomment
   the `<!-- SCREENSHOTS: ... -->` row that follows it.
3. Remove the "Placeholders — screenshots not captured yet" callout.
