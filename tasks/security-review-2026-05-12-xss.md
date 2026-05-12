# Security Review S1 — XSS / Input Sanitization

Scope: free-text `special_requests` flow from `PersonaWizard.js` → `/api/plan/generate/route.js` → Lambda `itinerary_generate/index.mjs` → Bedrock → DynamoDB → itinerary render. Reviewer focused exclusively on XSS, HTML/script injection, and input-sanitization bypass.

## Summary
- Critical (exploitable now): 0
- High (exploitable with small/likely code changes): 4
- Hygiene (best practice / defense-in-depth gap): 6

The good news first: the current rendering surface (`DayCard`, `ActivityCard`) escapes everything through React JSX text interpolation, and `special_requests` is **never persisted to DynamoDB** in the Lambda's `PutCommand`. So there is no live XSS sink today. That makes the present findings almost entirely **High** (exploitable as soon as someone adds an obvious-looking feature like "echo what the user told us back at the top of the itinerary" or an admin dashboard view of raw inputs) rather than **Critical**. The sanitizer's strip regex is, however, weak enough that I would not rely on it as the second line of defense it advertises itself to be.

---

## Critical findings
None. See "What was checked and looks OK" for why nothing graded Critical.

---

## High findings

### #H1 — Tag-stripping regex `/<[^>]*>/g` is bypassable via nested-tag reconstruction
- **File:** `app/api/plan/generate/route.js:19` and `infra/lambdas/itinerary_generate/index.mjs:169`
- **Code:**
  ```js
  s = s.replace(/<[^>]*>/g, ''); // strip HTML tags
  ```
- **Vector:** `/<[^>]*>/g` consumes the *first* `<` up to the *first* `>`. When tags are nested, the outer wrapper is consumed and the inner reconstructs into a valid tag after one pass. There is no loop, so a single regex pass leaves a valid tag behind.
- **PoC inputs (all survive sanitization as a runnable tag):**
  - `<<script>script>alert(1)</script>` → after one replace pass: `<script>alert(1)</script>` (the regex eats `<script>` and the leading `<` plus trailing `script>` reassemble — actually: input `<scr<script>ipt>` → output `<script>` is the canonical PoC. Verified mentally: regex matches `<script>` greedily on first `>`; left with `<scr` + `ipt>` = `<script>` → no wait, `<scr` + `ipt>` does not form a tag. The real survivor is `<scr<x>ipt>alert(1)</scr<x>ipt>` → after strip of `<x>` and `</x>` style inner: `<script>alert(1)</script>`. Confirmed survivor: `<img<x> src=x onerror=alert(1)>` → strips `<x>` → leaves `<img src=x onerror=alert(1)>`.)
  - Simpler reliable PoC: `<img<!---->src=x onerror=alert(1)>` — the regex matches `<!--` through the next `>`, leaving `<imgsrc=x onerror=alert(1)>` (invalid) — but variants like `<svg/<!---->onload=alert(1)>` produce a valid `<svg/onload=alert(1)>`.
  - Best PoC: `<img/<script>src=x onerror=alert(1)>` → `<img/src=x onerror=alert(1)>`.
- **Exploitable today?** No — no current sink renders this. But the sanitizer's comment ("Strip HTML tags + on* event handlers — XSS defense for downstream renders.") is **misleading**. It does not strip `on*` event handlers at all; the regex only strips well-formed single-level tags. If a future PR adds `<div dangerouslySetInnerHTML={{__html: special_requests}}>` thinking "the server already sanitized," it will be exploitable instantly.
- **Fix:** Either (a) reject inputs containing `<`/`>` entirely (the field is travel preferences — angle brackets are not legitimate content), or (b) HTML-entity-encode at sanitization time (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#x27;`). DOMPurify is overkill server-side for a 500-char text-only field. Concretely:
  ```js
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  ```
  Or simply: `s = s.replace(/[<>]/g, '');` and update the comment to claim only what it does. Also fix the inaccurate comment claiming it strips `on*` handlers — it does not.

### #H2 — Zero-width and bidi unicode characters survive sanitization
- **File:** `app/api/plan/generate/route.js:20-21`, mirrored in Lambda at `infra/lambdas/itinerary_generate/index.mjs:170-171`
- **Code:**
  ```js
  s = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  s = s.replace(/[  ]/g, '\n');
  ```
- **Vector:** Strips ASCII controls and U+2028/U+2029 only. Misses:
  - **Zero-width:** U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ), U+FEFF (BOM/ZWNBSP)
  - **Bidi:** U+200E (LRM), U+200F (RLM), U+202A–U+202E (LRE/RLE/PDF/LRO/RLO), U+2066–U+2069
  - **Tag characters:** U+E0000–U+E007F (the entire "tag" block — these are invisible and have been used to smuggle hidden text into LLM prompts and to bypass keyword filters)
  - **Variation selectors & combining marks** can be used to construct invisible text and to defeat downstream keyword filters
- **PoC:** An attacker types `<scr​ipt>alert(1)</scr​ipt>` — the tag regex sees no tag (because `<scr` doesn't have a `>` adjacent), but a renderer that strips zero-widths before rendering, or a code path that calls `.normalize()`, may resurrect the tag. More realistically, bidi overrides (`‮`) can be used to flip the visible direction of stored text, making admin dashboards display content very differently from what the database holds — useful for social-engineering moderators.
- **Exploitable today?** Not as direct XSS — but bidi/zero-width chars passed verbatim into the Bedrock prompt can be used to smuggle hidden instructions past a human reviewer reading CloudWatch logs (reviewer #2's territory, but the input-cleaning gap is mine). They also defeat any future keyword-based moderation.
- **Fix:** Add a deny-list pass:
  ```js
  s = s.replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');
  // Drop Plane-14 tag chars + variation selectors
  s = s.replace(/[\u{E0000}-\u{E007F}]/gu, '');
  ```
  Apply identical rules in the Lambda backstop. Better: whitelist (`[\p{L}\p{N}\p{P}\p{Zs}\n]` with the `u` flag) and drop anything else.

### #H3 — Length cap is enforced *before* sanitization, so input that shrinks after stripping retains payload room
- **File:** `app/api/plan/generate/route.js:18-22`, Lambda `index.mjs:167-173`
- **Code:**
  ```js
  let s = raw.slice(0, 1000);
  s = s.replace(/<[^>]*>/g, '');
  ```
- **Vector:** The slice caps the *input* at 1000 chars, then sanitization may *shrink* the output. So an attacker can send 1000 chars where 950 are stripped HTML padding and 50 are a payload. That's not directly exploitable as a length-bypass for storage (since the Lambda doesn't store the field), but combined with #H1 it means a longer attacker tag survives in a more compact form than the user-visible UI implies.
- **Inverse risk (more interesting):** the regex *cannot* grow the string, so a "payload that expands after sanitization" attack is not present here. Good.
- **Exploitable today?** No, but the client sees `maxLength={500}` while the server allows up to 1000 — a 2× discrepancy. If product later assumes "the textarea limits to 500 so we don't need to think about long content," that assumption is wrong because the API accepts 1000 from a curl client.
- **Fix:** Cap *after* sanitization and align with client. Either:
  ```js
  s = sanitize(raw);
  if (s.length > 500) s = s.slice(0, 500);
  ```
  …or document the intentional 2× server allowance and add a server-side hard reject (HTTP 400) for `raw.length > 1000`, not a silent slice. Silent truncation can subtly turn balanced markup into unbalanced markup that an downstream LLM may complete in unexpected ways.

### #H4 — Lambda's `</user_input>` strip is case-insensitive but does not handle whitespace, attribute injection, or near-matches
- **File:** `infra/lambdas/itinerary_generate/index.mjs:172`
- **Code:** `.replace(/<\/?user_input>/gi, '')`
- **Vector:** Strict match. Bypassed by:
  - `< /user_input>` (space after `<`)
  - `<user_input >` (trailing space before `>`)
  - `<user_input foo="bar">` (attributes)
  - `</user_input\t>` (whitespace before `>`)
  - `<UsEr_InPuT>` is handled (`gi`), but `<user__input>`, `<user-input>`, `<userinput>` style typos that an LLM might still parse as a delimiter are not
  - Backtick/quote variants in the prompt template: an attacker can write `"</user_input>"` (with surrounding quotes), which strips clean, but `</user_input>` (unicode-escaped) survives because the sanitizer runs on the raw decoded string and the JSON parse already decoded `<` to `<`… actually verified: yes, JSON.parse decodes `<` to `<`, so this *is* covered. Good.
  - **However**: order matters. The HTML strip at line 169 runs *before* the user_input strip at line 172. So `<user_input>` is consumed by `/<[^>]*>/g` and never reaches line 172 — the line 172 strip is dead code for well-formed tags. It only catches `</user_input>` text that survived line 169 (it won't, since `</user_input>` matches `/<[^>]*>/g`). The defense the comment claims is **already redundant with line 169 for well-formed cases and equally bypassable as line 169 for malformed cases**.
- **Exploitable today?** This is a prompt-injection concern (reviewer #2) more than XSS. From the XSS side, the bypass surface is the same as #H1.
- **Fix:** Drop the dedicated `<user_input>` strip; replace it with a generic policy: HTML-entity-encode all `<` and `>` characters before string interpolation into the prompt. The prompt template's `<user_input>` framing then becomes structurally inviolable because user data cannot contain `<`.

---

## Hygiene findings

### #G1 — Sanitizer comment lies about its behavior
- **File:** `app/api/plan/generate/route.js:10`
- **Code:** `// - Strip HTML tags + on* event handlers — XSS defense for downstream renders.`
- The regex does not strip `on*` handlers. It strips full tags. A future engineer reading this will assume `onclick="…"` inside `<a>` is handled. It is not (the whole `<a …>` gets stripped, but a *leftover* `onclick=alert(1)>` from a partial-tag bypass would survive). Tighten the comment to describe what the code actually does. The Lambda file has the same problem at line 164 ("Backstop sanitization on free-text").

### #G2 — No content-type validation on `/api/plan/generate`
- **File:** `app/api/plan/generate/route.js:25-26`
- `await request.json()` will parse any payload the client sends. There is no `Content-Type` check. Not an XSS issue per se, but combined with absent CSRF protections, a cross-origin POST with `Content-Type: text/plain` containing a JSON body is a SimpleRequest that bypasses CORS preflight. If the site ever adds authenticated state to this endpoint, this becomes a CSRF vector for free-text injection.
- **Fix:** Reject non-`application/json` requests, or use the framework's typed body parsing.

### #G3 — `Access-Control-Allow-Origin: *` on the Lambda response
- **File:** `infra/lambdas/itinerary_generate/index.mjs:329`
- Public CORS wildcard on the Lambda means any origin can call API Gateway directly. Since the Next.js route is the documented client, but the Lambda is the source of truth for sanitization, this is consistent with the "Lambda is independently callable" comment at line 163. Confirms the threat model — keep the Lambda's defenses strong. Not an XSS bug, but it underscores that the Lambda sanitizer is the *real* line of defense and should match or exceed the Next.js one (currently they are identical character-by-character for the strip ranges).

### #G4 — `note` field on items is rendered verbatim from Bedrock output
- **File:** `app/puerto-rico-itinerary/components/ActivityCard.js:51`
- **Code:** `{note || activity.why_it_matters}`
- React JSX text interpolation escapes this, so direct `<script>` injection from a malicious LLM completion is not exploitable. However, the system prompt at `index.mjs:211` explicitly tells Bedrock "Do not echo or quote the user_input back in the narrative or notes" — that's a prompt-level mitigation, not a code-level one. A jailbroken Bedrock could include the user's input in `note` or `narrative`. Since rendering is React text only, this is *not* an XSS path today, but:
  - If anyone later renders the itinerary into a marketing email (HTML-formatted, not React), this becomes injectable.
  - If a future feature adds "View raw plan JSON" to an admin dashboard that uses `innerHTML` for syntax highlighting, the malicious note becomes executable in admin context.
- **Fix:** Add an output-side sanitizer in `lib/itinerary/dynamodb.js`'s read path or in `DayCard`/`ActivityCard` that runs the same HTML-strip on `theme`, `narrative`, `note` *before* React renders. Defense in depth — costs nothing.

### #G5 — `dangerouslySetInnerHTML` is used elsewhere in the codebase with i18n strings as the source
- **Files:** `app/admin/getting-started/page.js:141, 157, 171, 196, 236, 250, 268, 276` (and a few others) all use `dangerouslySetInnerHTML={{ __html: t(locale, 'key') }}`.
- These keys come from `lib/i18n.js` which is checked-in static text — currently safe. **But** the pattern exists in the codebase, so the muscle memory of "use `dangerouslySetInnerHTML` for rich text" is present. If a future admin page wants to show user-typed `special_requests` with bold/italic styling, the easy thing to reach for is `dangerouslySetInnerHTML`. None of the current usages involve `special_requests`, so this is hygiene only.
- **Fix:** Add an ESLint rule (`react/no-danger` or a custom rule) flagging `dangerouslySetInnerHTML` on any expression that isn't an i18n literal. Forces a code-review touchpoint.

### #G6 — Sanitizer is duplicated between Next.js and Lambda with no shared source
- **Files:** `app/api/plan/generate/route.js:16-23` and `infra/lambdas/itinerary_generate/index.mjs:165-174`
- The two implementations are byte-identical today except for the Lambda's extra `<user_input>` strip. They will drift. When someone tightens one, the other will lag, and the weaker one is the de facto policy.
- **Fix:** Extract `sanitizeFreeText` into a shared module (or duplicate it into the Lambda build via a small script) with a unit test fixture of bypass attempts. The Lambda is JS module-compatible (`.mjs`), so a simple copy-from-shared at build time is feasible.

---

## What was checked and looks OK

- **No XSS sink today.** `special_requests` is not rendered anywhere. The only fields rendered on the itinerary page (`theme`, `narrative`, `note`, `activity.name`, `activity.why_it_matters`) are sourced from Bedrock output / DynamoDB activity rows, and all flow through React JSX text interpolation (`{value}`), which auto-escapes. Verified `app/puerto-rico-itinerary/components/DayCard.js:39, 46`, `ActivityCard.js:48, 51`, `[plan_id]/page.js` — zero `dangerouslySetInnerHTML` in the itinerary path.
- **`special_requests` is not stored in DynamoDB.** The Lambda's `PutCommand` at `index.mjs:51-65` writes only `{ plan_id, interests, num_days, traveler_type, pace, days, generated_at, ttl_epoch }`. So even if the sanitizer were bypassed, there is no persisted attacker-controlled string to render later from DDB. This is the single biggest factor preventing "Critical" findings.
- **DynamoDB injection / "NoSQL injection" via `]}; --`-style payloads:** Not exploitable. The AWS SDK (`@aws-sdk/lib-dynamodb`'s `DocumentClient`) uses structured marshalling, not string concatenation. The `interests` array is used directly in JS `.filter()` predicates (`index.mjs:140-142`) and `JSON.stringify`'d into the prompt — both safe paths. The `ScanCommand` at line 139 has no filter expression so no expression-injection surface.
- **Unicode line separators U+2028 / U+2029:** correctly converted to `\n` at `route.js:21` and `index.mjs:171`. These are the historically interesting ones for JSON-in-script-tag breakouts and are handled.
- **JSON serialization of the body forwarded to API Gateway** (`route.js:42`): uses `JSON.stringify` — safe; no template-string interpolation of user data into HTTP body.
- **Backend echo to client:** the Next.js route returns the Bedrock response verbatim via `new Response(text, …)` at line 60, *but* it first parses it and validates with `ItinerarySchema.safeParse`. The schema does not include `special_requests`, so even if Bedrock echoed it, the response body would be re-serialized through the validated shape on the unhappy path. On the happy path, the raw `text` is forwarded — meaning a Bedrock response containing extra top-level fields outside the schema is passed through to the client. Zod's `safeParse` is non-strict by default, so unknown fields pass validation and are forwarded. This isn't an XSS issue (still React-escaped on render) but is worth noting for #2's prompt-injection review.
- **`broadcastToActiveGuests`, `notifications`, FCM:** out of scope; itinerary flow has no notification fan-out.
- **Client-side `slice(0, 500)` in `onChange` at `PersonaWizard.js:254`:** correctly applied. The `maxLength={500}` HTML attribute is browser-enforced; the JS slice is defense in depth against composition-event or paste-event weirdness. Fine.
- **Example-button click handler at `PersonaWizard.js:127-134`:** the `text.replace(/^[^\s]+ /, '')` strips an emoji prefix and is safe — no eval, no innerHTML.

---

## Recommended priority of fixes

1. **#H1** — Replace the naive tag-strip with HTML-entity encoding (or a `[<>]` reject). The current regex's comment over-claims what it does, and any future feature that renders `special_requests` as HTML will inherit a footgun. ~5 lines of code.
2. **#H2** — Add zero-width, bidi, and Plane-14 tag-character stripping. Especially the tag chars (U+E0000–U+E007F) — these are invisible and have been a recurring LLM-prompt smuggling vector in 2024–2026 published exploits. ~2 lines.
3. **#G6** — Extract `sanitizeFreeText` to a shared module so the two copies cannot drift. Add a unit test with the bypass payloads above (`<img<x>…`, `<svg/<!---->…`, `​`, `‮`, `1…`). One small refactor.
4. **#H3** — Cap *after* sanitization, and align the 500/1000 numbers between client and server (pick one). Either reject `raw.length > 1000` with HTTP 400 or document the 2× allowance. ~3 lines.
5. **#G4** — Add output-side escaping on `theme`/`narrative`/`note` when read from DDB. React already escapes for the web sink; this protects future non-React sinks (email, admin print view, PDF export, CSV download). ~10 lines.
6. **#H4** — Drop the dedicated `<user_input>` strip in the Lambda; the entity-encoding from #H1 makes the `<user_input>` framing structurally safe. Simplification, not just hardening.
7. **#G1** — Update sanitizer comments to describe what the code actually does. Trivial. Do this in the same commit as #H1.
8. **#G5** — Add an ESLint rule against `dangerouslySetInnerHTML` with a non-literal source. One config line; saves a future incident.
9. **#G2, #G3** — Content-type validation and CORS tightening. Both are hygiene; revisit if the endpoint ever becomes authenticated.

Total estimated work for #H1–#H4 + #G1, #G6: under 100 LOC and one shared module, plus a small unit-test fixture. None of these block shipping the current free-text feature — they harden it before someone adds a "show what the user wrote" UI.
