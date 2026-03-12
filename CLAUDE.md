# Casa Coqui — Guest Portal & Property Management App

## Project Overview
A Progressive Web App (PWA) for a multi-family Airbnb property (2 units). Two audiences:
- **Guest Portal**: Mobile-first experience accessed via unique link + phone verification. Guests see check-in guide, parking, house rules, WiFi, laundry status, community board, maintenance requests, and direct messaging.
- **Admin Dashboard**: Host-facing panel for managing bookings, broadcasting notifications, tracking expenses, supply inventory with auto-reorder, maintenance requests, bill storage, and revenue/occupancy reporting.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: JavaScript (no TypeScript)
- **Styling**: Tailwind CSS (utility-first, mobile-first)
- **Backend/DB**: Firebase Firestore (NoSQL, real-time)
- **Auth**: Firebase Auth (Phone OTP for guests, email/password for admin)
- **Storage**: Firebase Cloud Storage (photos, receipts, PDFs)
- **Cloud Functions**: Firebase Cloud Functions (email parsing, scheduled tasks)
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **SMS**: Twilio (backup notifications + OTP)
- **Hosting**: Vercel
- **PWA**: next-pwa (service worker, offline, add-to-homescreen)

## Coding Conventions
- Functional components only, no class components
- React hooks for all state management (useState, useEffect, useContext)
- Tailwind CSS for ALL styling — no CSS modules, no styled-components
- File naming: kebab-case for files, PascalCase for components
- Use async/await, never raw promises with .then()
- Environment variables in .env.local (prefixed NEXT_PUBLIC_ for client-side)
- All Firebase config via environment variables, never hardcoded
- API routes return consistent JSON: { success: true, data: {} } or { success: false, error: "" }

## Project Structure
```
/app
  /g/[code]          — Guest portal (dynamic route per booking)
    /page.js         — Guest home screen
    /checkin/page.js — Pre-arrival check-in form
  /admin
    /page.js         — Admin dashboard
    /bookings/       — Booking management
    /notify/         — Mass notifications
    /expenses/       — Expense tracking
    /supplies/       — Supply inventory
    /maintenance/    — Maintenance inbox
    /messages/       — Guest message threads
    /receipts/       — Bill/receipt browser
    /revenue/        — Revenue tracking
    /calendar/       — Occupancy calendar
    /login/page.js   — Admin login
  /api
    /bookings/       — Booking CRUD + link generation
    /guests/         — Phone verify, confirm, check-in
    /notifications/  — Broadcast + direct messaging
    /expenses/       — Expense CRUD + reports
    /supplies/       — Supply CRUD + reorder
    /maintenance/    — Request CRUD + status updates
    /laundry/        — Status get/toggle
    /receipts/       — Inbound email webhook + monthly list
    /revenue/        — Revenue CRUD
/components
  /guest/            — Guest-specific components
  /admin/            — Admin-specific components
  /ui/               — Shared UI primitives (Button, Card, Badge, etc.)
/lib
  firebase.js        — Firebase app init + Firestore/Auth/Storage helpers
  twilio.js          — Twilio SMS send + OTP helpers
  notifications.js   — Unified push + SMS notification logic
/hooks
  useAuth.js         — Auth hook (guest phone + admin email)
  useFirestore.js    — Real-time Firestore subscription hook
  usePush.js         — FCM push registration + permission
/public
  manifest.json      — PWA manifest
  sw.js              — Service worker
  /icons/            — PWA icons (192x192, 512x512)
```

## Database (Firestore Collections)
See Casa-Coqui-Project-Spec.docx Section 5 for full schema. Key collections:
- `bookings` — Booking records with guest link codes
- `guests` — Guest profiles from check-in forms
- `notifications` — Broadcast + direct messages
- `expenses` — Expense entries with categories
- `supplies` — Inventory with qty, min, auto-reorder
- `maintenance` — Requests with status tracking
- `laundry` — Machine status (washer/dryer docs)
- `receipts` — Parsed email receipts by month
- `revenue` — Income per booking
- `settings` — App config (property name, codes, WiFi, templates)

## Key Flows to Understand
1. **Guest Access**: Host creates booking → unique link generated → guest taps link → phone OTP verification → check-in form → portal access → link expires at checkout
2. **Parking Report**: Guest reports → photo uploaded to Storage → generic broadcast auto-sent to all guests via push + SMS → host gets full details separately
3. **Notifications**: Host triggers broadcast → fetch active guests → send FCM push to those with tokens → send Twilio SMS to rest → log delivery status
4. **Auto-Reorder**: Cloud Function runs on schedule → checks supplies against minimums → generates Amazon cart link → pushes notification to admin for approval
5. **Receipt Storage**: Email forwarded to dedicated address → Cloud Function parses → stores in Storage → files by month in Firestore

## Build Phases
- **Phase 1** (Foundation): Project setup, Firebase, auth, guest portal pages, admin booking creation
- **Phase 2** (Real-Time): Laundry status, community board, parking reports, notifications
- **Phase 3** (Admin Management): Expenses, supplies, maintenance, receipts
- **Phase 4** (Reports & Polish): Monthly reports, tax export, PWA optimization, deploy

## Important Notes
- Mobile-first design — most users (guests AND admin) will be on phones
- Admin is a single user (the host) — no role management needed
- Guest-to-guest communication is NOT supported — host is the hub
- Laundry status is guest self-reported (honor system)
- All dates/times should be in the property's local timezone
