# Graph Report - .  (2026-04-16)

## Corpus Check
- Large corpus: 308 files · ~341,128 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1236 nodes · 2102 edges · 85 communities detected
- Extraction: 67% EXTRACTED · 33% INFERRED · 0% AMBIGUOUS · INFERRED: 692 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Auth & Admin Routes|API Auth & Admin Routes]]
- [[_COMMUNITY_Admin Layout & Guest Setup|Admin Layout & Guest Setup]]
- [[_COMMUNITY_Bookings & Notification Settings|Bookings & Notification Settings]]
- [[_COMMUNITY_Pricing Rate Engine|Pricing Rate Engine]]
- [[_COMMUNITY_Competitor Analysis & DB|Competitor Analysis & DB]]
- [[_COMMUNITY_Project Overview & Config|Project Overview & Config]]
- [[_COMMUNITY_Messaging & Chat|Messaging & Chat]]
- [[_COMMUNITY_Embeddings & Cloud Functions|Embeddings & Cloud Functions]]
- [[_COMMUNITY_Pricing Decision Engine|Pricing Decision Engine]]
- [[_COMMUNITY_Reservation Agent Flow|Reservation Agent Flow]]
- [[_COMMUNITY_Staff Assignments & Hours|Staff Assignments & Hours]]
- [[_COMMUNITY_Admin Calendar Plan|Admin Calendar Plan]]
- [[_COMMUNITY_Pricing AI Advisor|Pricing AI Advisor]]
- [[_COMMUNITY_Calendar Helpers|Calendar Helpers]]
- [[_COMMUNITY_Cleaning & Maintenance|Cleaning & Maintenance]]
- [[_COMMUNITY_Pricing Dashboard & API|Pricing Dashboard & API]]
- [[_COMMUNITY_Guest Portal Layout|Guest Portal Layout]]
- [[_COMMUNITY_AWS CDK Infrastructure|AWS CDK Infrastructure]]
- [[_COMMUNITY_Batch Market Capture|Batch Market Capture]]
- [[_COMMUNITY_Screen Mockup Components|Screen Mockup Components]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]

## God Nodes (most connected - your core abstractions)
1. `t()` - 146 edges
2. `GET()` - 130 edges
3. `POST()` - 92 edges
4. `useLocale()` - 59 edges
5. `useAuth()` - 27 edges
6. `PATCH()` - 25 edges
7. `DELETE()` - 24 edges
8. `main()` - 21 edges
9. `analyzeDateMultiStay()` - 21 edges
10. `useCollection()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Receipt Storage Flow (email → Cloud Function → Storage → Firestore)` --semantically_similar_to--> `Parse Airbnb Email Lambda`  [INFERRED] [semantically similar]
  CLAUDE.md → AGENT-RESERVATION-FLOW-PLAN.md
- `createBookingFromConfirmation()` --calls--> `GET()`  [INFERRED]
  infra/lambda/parse-airbnb-email/index.js → app/api/guests/invite/route.js
- `isDuplicate()` --calls--> `GET()`  [INFERRED]
  infra/lambda/parse-airbnb-email/index.js → app/api/guests/invite/route.js
- `gatherDataCoverageEvidence()` --calls--> `getAutopilotRuns()`  [INFERRED]
  lib/pricing-evidence.js → tools/pricing/lib/db.js
- `GET()` --calls--> `getRunObservations()`  [INFERRED]
  app/api/guests/invite/route.js → tools/pricing/lib/db.js

## Hyperedges (group relationships)
- **Reservation Agent Pipeline: ICS → Welcome Draft → Admin Review** — agent_ics_sync, agent_welcome_ai, agent_agent_runs_collection [EXTRACTED 0.95]
- **Inbound Email Reply Pipeline: SES → Lambda → Firestore → Reply Agent** — agent_ses_subdomain, agent_inbound_email_lambda, agent_airbnb_messages_collection, agent_reply_ai [EXTRACTED 0.95]
- **Smart Pricing Pipeline: Scrape → Purge → Analyze (TCPN + Seasonal) → Recommend** — pricing_scraper, pricing_purge_pattern, pricing_v2_engine, pricing_recommendations_v2_table [EXTRACTED 0.92]
- **Pricing Intelligence System (CLI + Data Model + Filter)** — batch_market_capture_cli, competitor_pricing_data_model_3layer, market_research_filter_fix_bedroom_filter [EXTRACTED 0.95]
- **Voice Learning Pipeline (Implicit + Explicit + Profile)** — voice_matched_ai_plan_implicit_learning, voice_matched_ai_plan_refine_drawer, voice_matched_ai_plan_voice_profile [EXTRACTED 0.95]
- **Messaging Unification Flow (threadKey + Welcome PATCH + Thread Link)** — welcome_drafts_plan_thread_key, welcome_drafts_plan_patch_welcome_api, welcome_drafts_plan_link_api [EXTRACTED 0.90]

## Communities

### Community 0 - "API Auth & Admin Routes"
Cohesion: 0.02
Nodes (89): requireAuth(), requireRole(), verifyAuth(), main(), main(), main(), cascadeCleaningJobDates(), check() (+81 more)

### Community 1 - "Admin Layout & Guest Setup"
Cohesion: 0.02
Nodes (96): AdminLayoutInner(), Community(), PostCard(), ReplyThread(), typeAccent(), TypeBadge(), CommunityPost(), getPostTypes() (+88 more)

### Community 2 - "Bookings & Notification Settings"
Cohesion: 0.02
Nodes (79): AccessCodes(), CodeCard(), CopyButton(), WifiCard(), formatMonthYear(), CheckInGuide(), getFallbackSteps(), InviteForm() (+71 more)

### Community 3 - "Pricing Rate Engine"
Cohesion: 0.06
Nodes (46): insertRate(), parseArgs(), run(), main(), main(), buildDateRanges(), computeAnchorDates(), main() (+38 more)

### Community 4 - "Competitor Analysis & DB"
Cohesion: 0.06
Nodes (55): extractAirbnbId(), parseArgs(), run(), getAutopilotRuns(), getCalendarSummary(), getCaptureBatch(), getCaptureBatches(), getCompAvailabilityAcrossRuns() (+47 more)

### Community 5 - "Project Overview & Config"
Cohesion: 0.04
Nodes (52): March 12 2026 Build Recap, Auto-Reorder Flow (Cloud Function → supplies check → Amazon cart), Firebase Stack (Firestore, Auth, Storage, Functions, FCM), Guest Access Flow (link → OTP → check-in → portal → expiry), CLAUDE.md: Casa Coqui Project Spec & Conventions, Next.js 14 App Router Application, Parking Report Flow (photo → Storage → broadcast), Receipt Storage Flow (email → Cloud Function → Storage → Firestore) (+44 more)

### Community 6 - "Messaging & Chat"
Cohesion: 0.07
Nodes (32): main(), Chat(), DateDivider(), formatTime(), MessageBubble(), CommunityPreview(), findMatchingBooking(), AirbnbMessageCard() (+24 more)

### Community 7 - "Embeddings & Cloud Functions"
Cohesion: 0.07
Nodes (27): embedBatch(), embedText(), getApiKey(), expireLinksHandler(), normalizeCheckoutDate(), todayInPropertyTz(), classifyEmail(), createBookingFromConfirmation() (+19 more)

### Community 8 - "Pricing Decision Engine"
Cohesion: 0.13
Nodes (27): classifyAvailability(), computeAvailabilitySummary(), applyDecisionMatrix(), applyGuardrails(), checkSignalAgreement(), classifyMarketTrend(), computeSuggestedRate(), makeDecision() (+19 more)

### Community 9 - "Reservation Agent Flow"
Cohesion: 0.09
Nodes (30): Firestore Collection: agent_runs, Firestore Collection: airbnb_messages, Firestore Collection: airbnb_messages_quarantine, CasaCoquiEmailStack CDK Stack, Anthropic Model: claude-haiku-4-5, Flow A: New Reservation (ICS → Booking → Welcome Draft), Flow B: Inbound Guest Message (SES → Lambda → Reply Draft), icsSync Cloud Function (+22 more)

### Community 10 - "Staff Assignments & Hours"
Cohesion: 0.09
Nodes (12): AssignmentCard(), EmptyState(), EstVsActual(), formatHours(), formatMinutes(), HoursPage(), isOverdue(), isSameMonth() (+4 more)

### Community 11 - "Admin Calendar Plan"
Cohesion: 0.07
Nodes (29): AgendaView Component (admin calendar), buildAgendaForWindow Helper Function, buildWarningList Helper Function, lib/__tests__/calendar-helpers.test.js (Unit Tests), CalendarView Component with Color Pills, CleaningJobForm (initialUnit + initialDate prefill props), DayDetailSheet (Simplified), Fix → Deep-Link (/admin/cleaning?new=1&unit&date) (+21 more)

### Community 12 - "Pricing AI Advisor"
Cohesion: 0.19
Nodes (24): answerEvidenceQuestion(), buildAdvisorInput(), chatWithAdvisor(), enforcePassthrough(), generatePricingAdvice(), getPricingLib(), defaultDateFrom(), gatherAvailabilityEvidence() (+16 more)

### Community 13 - "Calendar Helpers"
Cohesion: 0.14
Nodes (17): addDaysYmd(), bookingDaysInMonth(), bookingStatus(), buildAgendaForWindow(), buildCalendarGrid(), buildWarningList(), dateToYMD(), formatDateFull() (+9 more)

### Community 14 - "Cleaning & Maintenance"
Cohesion: 0.12
Nodes (16): CleaningCalendar(), CleaningPage(), ConfirmDialog(), dateToYMD(), formatMonthYear(), getAvatarColor(), getCategoryLabel(), getDaysInMonth() (+8 more)

### Community 15 - "Pricing Dashboard & API"
Cohesion: 0.12
Nodes (22): POST /api/pricing/autopilot API Route (dashboard-triggered analysis), Autopilot Pipeline Orchestrator (autopilot.js: scrape → analyze → report), DB Table: competitors, Confidence Scoring (0-100 composite, hard zero < 3 comps), Admin Pricing Dashboard (/admin/pricing), Puerto Rico + US Holiday Calendar (holidays.js, peak multipliers 1.1x-1.5x), Purge-Before-Write Pattern (data freshness), Rationale: Multi-Stay Analysis (5 stay lengths) enables weekly/monthly discount strategy (+14 more)

### Community 16 - "Guest Portal Layout"
Cohesion: 0.11
Nodes (8): BottomNav(), GuestLayoutInner(), getAllArticles(), getArticlesForPage(), getHelpContext(), searchArticles(), HelpDrawer(), useNotifications()

### Community 17 - "AWS CDK Infrastructure"
Cohesion: 0.12
Nodes (12): CasaCoquiEmailStack, CasaCoquiEmailStack — inbound email infrastructure for receipt parsing.  Resourc, Inbound email pipeline: SES → S3 → Lambda → Firestore., CasaCoquiFoundationStack, CasaCoquiFoundationStack — long-lived CI/CD foundation.  Resources:   * KMS CMK, Create-once, never-delete foundation for the Casa Coqui pipeline., Casa Coqui CDK stacks package., CasaCoquiPipelineStack (+4 more)

### Community 18 - "Batch Market Capture"
Cohesion: 0.12
Nodes (19): Analytical Views v13 (v_comp_price_timeline etc.), Batch CRUD Functions (createCaptureBatch etc.), capture_batches Table (v13), Batch Market Capture CLI, Historical Analysis Functions (getCompPriceHistory etc.), Single Playwright Session (Browser Reuse Strategy), research_runs Table (batch_id FK), run_observations.day_type Column (+11 more)

### Community 19 - "Screen Mockup Components"
Cohesion: 0.12
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.28
Nodes (12): currentMonthYM(), currentYear(), Expenses(), FileIcon(), formatCurrency(), formatMonthLabel(), isImage(), isPdf() (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (12): CalendarView(), CleanerHome(), DoneSection(), formatDateFull(), getDateLabel(), getGreeting(), JobRow(), JobSheet() (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (3): GetStartedPage(), InstallGuidePage(), usePlatform()

### Community 23 - "Community 23"
Cohesion: 0.47
Nodes (7): getAvailabilityTransitions(), getMarketMovementSummary(), getPriceMovements(), getRepeatCompStats(), getUnitCompIds(), resolveLastTwoCalendarRuns(), resolveLastTwoRuns()

### Community 24 - "Community 24"
Cohesion: 0.28
Nodes (9): Implicit Voice Learning (onAirbnbMessageSent trigger), app/api/ai/refine/route.js (Chat Refinement API), RefineDrawer Component (Chat-Based Draft Refinement), scripts/seed-voice-profile.js (Bootstrap from Message History), Voice Profile (settings/voice_profile Firestore doc), lib/voice-profile.js (Load, Update, Inject Voice Profile), Voice-Matched AI — Design Spec, Voice Profile Rules (30 max) and Examples (10 max) (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.38
Nodes (3): filterRAGResults(), buildReplyInput(), generateReply()

### Community 27 - "Community 27"
Cohesion: 0.4
Nodes (6): buildReplyInput Function (lib/reply-ai.js), Chain Evaluator Property Fact Hard Rules, lib/rag-filter.js (RAG Filter Module), PROPERTY_FACT_FILTERS (no_car_rental, no_traffic_hedging), Rationale: Remove Conflicting Data Before Model Sees It, Two-Layer Defense Architecture (data layer + validation layer)

### Community 28 - "Community 28"
Cohesion: 0.5
Nodes (2): main(), mkCode()

### Community 29 - "Community 29"
Cohesion: 0.7
Nodes (4): buildCartUrl(), extractAsin(), notifyAdmin(), reorderCheckHandler()

### Community 30 - "Community 30"
Cohesion: 0.5
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 0.5
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 0.83
Nodes (2): buildThinkPrompt(), generateReplyThink()

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (2): buildDrafterPrompt(), generateReplyChain()

### Community 35 - "Community 35"
Cohesion: 0.5
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 0.83
Nodes (3): extractAmount(), parseMultipart(), parseReceiptHandler()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): cleaningReminderHandler(), interpolate()

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (2): ForegroundToast.js Component, firebase-messaging-sw.js: Service Worker

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (2): Bug: SMS fallback sends phone number as FCM token (silent failure), app/api/messages/notify/route.js

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (2): POST /api/messages/threads/link (Link Unmatched Thread to Booking), LinkToBookingModal (Unmatched Thread Linking)

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **84 isolated node(s):** `CasaCoquiEmailStack — inbound email infrastructure for receipt parsing.  Resourc`, `Inbound email pipeline: SES → S3 → Lambda → Firestore.`, `CasaCoquiPipelineStack — rebuildable CI/CD pipeline.  Resources:   * CfnParamete`, `Rebuildable CI/CD pipeline. Destroys cleanly without touching Foundation.`, `# NOTE: `BadgeEnabled=True` is intentionally NOT set on this project.` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 41`** (2 nodes): `layout.js`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `layout.js`, `AdminLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `page.js`, `NotificationSettingsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `page.js`, `LaundryPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `page.js`, `ChatPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `page.js`, `NotificationsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `ImageUpload.js`, `ImageUpload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `RefineDrawer.js`, `RefineDrawer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `StaffNotificationBell.js`, `StaffNotificationBell()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `CleaningJobForm()`, `CleaningJobForm.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `WelcomeExperience.js`, `WelcomeExperience()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `fix()`, `fix-cleaner-claims.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `getText()`, `convert-messages-to-jsonl.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `createAdmin()`, `create-admin.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `deploy()`, `deploy-rules.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `main()`, `check-cleaner-claims.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `promote()`, `promote-admin.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `seed-settings.js`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `seed-welcome-template.js`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `rate-limit.js`, `createRateLimiter()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `getServiceAccount()`, `firebaseInit.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (2 nodes): `ForegroundToast.js Component`, `firebase-messaging-sw.js: Service Worker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (2 nodes): `Bug: SMS fallback sends phone number as FCM token (silent failure)`, `app/api/messages/notify/route.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (2 nodes): `POST /api/messages/threads/link (Link Unmatched Thread to Booking)`, `LinkToBookingModal (Unmatched Thread Linking)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `tailwind.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `postcss.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `next.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `app.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `scrape-airbnb-price.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `init-db.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `sw.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `check-wifi.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `check-booking.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `gen-welcome.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `check-settings.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `constants.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `firebase-admin.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `firebase.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `resend.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `welcome-status.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `calendar-helpers.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `thread-key.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `API Auth & Admin Routes` to `Bookings & Notification Settings`, `Pricing Rate Engine`, `Competitor Analysis & DB`, `Messaging & Chat`, `Embeddings & Cloud Functions`, `Pricing Decision Engine`, `Community 40`, `Pricing AI Advisor`, `Community 23`, `Community 29`?**
  _High betweenness centrality (0.326) - this node is a cross-community bridge._
- **Why does `GuestHomeContent()` connect `Bookings & Notification Settings` to `API Auth & Admin Routes`, `Admin Layout & Guest Setup`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Why does `t()` connect `Admin Layout & Guest Setup` to `Bookings & Notification Settings`, `Messaging & Chat`, `Staff Assignments & Hours`, `Cleaning & Maintenance`, `Guest Portal Layout`, `Community 21`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Are the 145 inferred relationships involving `t()` (e.g. with `LaundryMachineCard()` and `CohostDashboard()`) actually correct?**
  _`t()` has 145 INFERRED edges - model-reasoned connections that need verification._
- **Are the 94 inferred relationships involving `GET()` (e.g. with `middleware()` and `createBookingFromConfirmation()`) actually correct?**
  _`GET()` has 94 INFERRED edges - model-reasoned connections that need verification._
- **Are the 36 inferred relationships involving `POST()` (e.g. with `requireAuth()` and `nt()`) actually correct?**
  _`POST()` has 36 INFERRED edges - model-reasoned connections that need verification._
- **Are the 58 inferred relationships involving `useLocale()` (e.g. with `LaundryMachineCard()` and `CohostDashboard()`) actually correct?**
  _`useLocale()` has 58 INFERRED edges - model-reasoned connections that need verification._