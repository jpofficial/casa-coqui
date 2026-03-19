# Guest Notification Isolation Fix (2026-03-18)

## Problem
New guests saw broadcast notifications from prior bookings. The notification center was not empty for brand-new guests who had no notifications.

## Root Causes (TWO)

### 1. Broadcast query had no temporal scoping (PRIMARY)
- `useNotifications` Query B: `where('broadcast', '==', true)` returned ALL broadcasts ever
- No filter by booking period → new guests saw old parking alerts, announcements
- File: `hooks/useNotifications.js`

### 2. Firestore rules overly permissive type check (SECONDARY)
- Rule: `resource.data.type in ['broadcast', 'parking', ...]` allowed any authenticated user to read any notification with common type
- Defense-in-depth gap — not actively exploited but should not exist
- File: `firestore.rules` line 88

### What was NOT the cause
- Not client cache/localStorage/IndexedDB/service worker
- Not stale auth sessions or claims
- Not backend API scoping (write paths correctly use bookingCode)
- `useNotifications` dependency array is correct — re-subscribes on bookingCode change

## Fix Applied

### useNotifications.js
- Hook now looks up `bookings` collection for the guest's `checkInDate`
- Broadcast query adds `where('createdAt', '>=', checkInDate)` when available
- Uses async/cancellation pattern for cleanup safety
- Falls back to unfiltered if booking lookup fails
- Existing `broadcast+createdAt` composite index supports this query

### firestore.rules
- Removed: `resource.data.type in ['broadcast', 'parking', 'general', 'maintenance', 'community', 'direct', 'push']`
- Kept: `broadcast == true`, `guestId == uid`, `bookingCode == token.bookingCode`

## Deployment
- Vercel: automatic on push
- Firestore rules: requires `firebase deploy --only firestore:rules`
- No new indexes needed

## Investigation Reviewed
- 9 change notes, 2 architecture docs, 2 agent memory files, 2 project-level docs
- All prior notification fixes preserved
- No regressions introduced
