# Duplicate Notification Fix — 2026-03-17

## Root Causes
1. Maintenance status buttons had no loading guard — double-click = 2 PATCHes = 2 notifications
2. Assignments route sendDirectMessage was fire-and-forget (not awaited)
3. Maintenance + Assignments dual-path both call sendDirectMessage independently
4. Zero idempotency in any notification write

## Fixes
- `changingStatus` loading guard on maintenance status buttons
- `await` on sendDirectMessage in PATCH /api/assignments/[id]
- 30s dedup window in sendDirectMessage (bookingCode+category+title query)
- sourceAction/sourceId context fields on all notification writes
- Composite index: notifications(bookingCode, category, title, createdAt)

## Files Changed
- app/admin/maintenance/page.js
- app/api/assignments/[id]/route.js
- lib/notifications.js
- lib/staff-notifications.js
- app/api/maintenance/[id]/route.js
- firestore.indexes.json

## Deploy Note
firebase deploy --only firestore:indexes (after Vercel deploy)
