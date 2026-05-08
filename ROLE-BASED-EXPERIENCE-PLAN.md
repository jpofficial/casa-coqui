# Casa Coqui — Role-Based Experience System
# Production Architecture & Implementation Plan

---

## 1. Executive Summary

### What exists today
Casa Coqui has a basic RBAC system with four roles (admin, cohost, cleaner, maintenance) enforced via client-side route filtering and partial server-side API authorization. The cohost is currently a "mini admin" — they see the same pages as admin with the same buttons, just fewer of them. The cleaner sees a single page designed for admin operations, not for cleaners. There is no task/assignment system, no structured cleaning workflow, no Spanish support, and no property-scoped access.

### What the co-host role should be
An **Operations Assistant** with a purpose-built view. The co-host should see an operational dashboard focused on current guest activity, maintenance status, cleaning status, and admin-assigned tasks. They should NOT see the same booking creation UI, message threads, or broadcast tools as admin. They should have a dedicated **Assignments** view where they receive and complete tasks from the admin.

### What the cleaner role should be
A **Spanish-first mobile task worker**. The cleaner should never see a "dashboard." They should see a single list of their upcoming cleaning jobs and, when it's time to clean, a step-by-step wizard that walks them through the entire process — from "Voy en camino" to photo upload to completion. The experience should be simpler than texting.

### What the admin assignment/todo system should be
A **hybrid task system** where admin can create one-off tasks (e.g., "Check if guest left charger in Unit A") and optionally use repeatable checklist templates (e.g., "Turnover Checklist: towels, dishes, trash, linens"). Tasks are assigned to a specific team member (co-host or cleaner), have a due date, priority, and status lifecycle. Admin sees all assignments in a dedicated Assignments page. The assignee sees their tasks in their own role-specific view.

### Biggest risks in the current architecture

| Risk | Severity | Detail |
|------|----------|--------|
| **11 API routes have zero authentication** | CRITICAL | Bookings, expenses, revenue, supplies, notifications (GET), laundry, receipts, and guest-link email endpoints are fully public. Anyone on the internet can create bookings, delete financial records, or send emails from the Casa Coqui domain. |
| **No Next.js middleware** | HIGH | All frontend route protection is client-side via `useEffect` in the admin layout. An attacker (or a curious co-host) can call any unprotected API directly. |
| **Co-host has full booking access** | HIGH | The co-host can see all booking data (guest names, link codes, dates) and there's no distinction between "view occupancy" and "manage bookings" at the API level. The booking creation endpoint has no auth at all. |
| **No property-scoped access** | MEDIUM | Today this is a single-property app, but there's no foundation for property/unit assignment. If a second co-host or cleaner is added for only one unit, there's no way to scope their access. |
| **FCM push is disconnected** | MEDIUM | The `usePush` hook is implemented but never imported anywhere. All notifications fall through to paid SMS via Twilio. No `firebase-messaging-sw.js` exists for background push. |
| **No cleaning workflow** | MEDIUM | The cleaning page is a basic confirmation form, not a structured workflow with acknowledgment, photo documentation, issue reporting, or status tracking. |
| **No i18n / Spanish support** | MEDIUM | All UI text is hardcoded English. The cleaner experience requirement is Spanish-first, but zero infrastructure exists. |

### What should be fixed first (priority order)
1. **Secure all unprotected API routes** — this is a production blocker
2. **Add Next.js middleware** for defense-in-depth route protection
3. **Build the co-host operational view** with filtered data endpoints
4. **Build the admin assignment/todo system**
5. **Build the cleaner wizard experience** with Spanish support
6. **Integrate FCM push** to reduce SMS costs and enable staff notifications
7. **Add property-scoped access** foundation for future scaling

---

## 2. Recommended Role Definitions

### Admin (Property Owner/Operator)

| Action | Scope |
|--------|-------|
| **View** | Everything: bookings, finances, settings, team, all guests, all notifications, all maintenance, all cleaning, all assignments |
| **Create** | Bookings, expenses, revenue entries, supplies, broadcasts, direct messages, assignments/tasks, team invites |
| **Update** | Booking status, maintenance status, supply quantities, settings, team roles, assignment status |
| **Delete** | Expenses, revenue entries, supplies, team members (deactivate) |
| **Message** | All guests (direct + broadcast), all staff |
| **Manage** | Team invites, role changes, deactivation, property settings |

### Co-host (Operations Assistant)

| Action | Scope |
|--------|-------|
| **View** | Current stays (filtered: unit, dates, guest first name only — no link codes, no financial data), occupancy calendar (read-only), maintenance requests, cleaning status, community board, assigned tasks |
| **Update** | Assigned task status (in progress, done), maintenance notes |
| **Create** | Operational notes on maintenance items |
| **Message** | Admin/host only (not guests directly — admin is the guest communication hub) |
| **NOT access** | Booking creation/edit, expenses, revenue, receipts, supplies management, settings, team management, guest link codes, financial data, broadcast notifications |

**Key restriction**: Co-host should NOT have access to `POST /api/bookings`, `POST /api/notifications/broadcast`, or `POST /api/notifications/direct`. The current codebase gives co-host broadcast and direct message access — this should be revoked. Co-host should communicate with admin, not directly with guests.

### Cleaner (Task Worker)

| Action | Scope |
|--------|-------|
| **View** | Assigned cleaning jobs only (unit name, date, turnover notes, special instructions) |
| **Update** | Cleaning job status (acknowledged → en_route → arrived → cleaning → completed) |
| **Create** | Issue reports during cleaning, supply requests, photo uploads (before/after) |
| **Message** | Admin only (via simple issue report, not a chat interface) |
| **NOT access** | Bookings, guest details (beyond unit/date), finances, settings, team, calendar, community board, maintenance (unless it's a cleaning-discovered issue), broadcasts, messages |

### Maintenance (Task Worker)

| Action | Scope |
|--------|-------|
| **View** | Assigned maintenance requests only |
| **Update** | Maintenance request status and notes |
| **Create** | Notes on maintenance items |
| **Message** | Admin only (via maintenance notes) |
| **NOT access** | Bookings, finances, settings, team, cleaning, calendar, community, broadcasts |

### Guest

| Action | Scope |
|--------|-------|
| **View** | Own booking info (check-in guide, access codes, parking, rules, laundry status, community board) |
| **Create** | Maintenance requests, parking reports, chat messages to host |
| **Update** | Laundry status (honor system), own check-in data |
| **NOT access** | Any admin routes, other guests' data, financial data, team data |

---

## 3. Recommended Co-Host Experience

The co-host should have a **purpose-built Operations view**, not a filtered version of the admin dashboard.

### Co-Host Dashboard (`/admin`)
Shows an operations-focused summary:
- **Active Stays**: Cards showing Unit A / Unit B occupancy with guest first name, check-in/out dates, and status. No booking codes, no guest links, no financial data.
- **My Assignments**: Top 3 pending tasks assigned by admin, with quick status update buttons.
- **Maintenance Summary**: Count of open/in-progress maintenance requests with links to details.
- **Cleaning Status**: Today's cleaning schedule with current status.
- **Quick Actions**: "Message Admin" button.

### Co-Host Assignments View (`/admin/assignments`)
A new page dedicated to admin-assigned tasks:
- **Tabs**: Active | Completed
- **Active tab**: Cards for each pending/in-progress task showing title, description, due date, priority badge, assignment date
- **Status buttons**: "Start" (pending → in_progress), "Done" (in_progress → completed)
- **Completion notes**: Optional text field when marking done
- **Completed tab**: History of completed tasks for reference

### Co-Host Stays View (`/admin/stays`)
A new page replacing co-host access to `/admin/bookings`:
- Shows only active and upcoming stays (not all historical bookings)
- Shows: unit, guest first name, check-in date, check-out date, status
- Does NOT show: booking code, guest link URL, guest phone, guest email, financial data
- Read-only — no create/edit/delete buttons

### Co-Host Maintenance View (`/admin/maintenance`)
Same as current, but:
- Co-host can add notes
- Co-host can NOT change status to "done" (only admin can close maintenance items)
- Co-host can NOT see guest contact details

### Co-Host Calendar View (`/admin/calendar`)
Read-only occupancy calendar. No booking creation affordance.

### Co-Host Cleaning View (`/admin/cleaning`)
Read-only cleaning status dashboard. Co-host can see cleaning schedule and current job status but cannot confirm cleanings (that's the cleaner's job).

### What Co-Host Should NOT See
- `/admin/bookings` (replaced by `/admin/stays`)
- `/admin/expenses`
- `/admin/supplies`
- `/admin/receipts`
- `/admin/revenue`
- `/admin/settings`
- `/admin/team`
- `/admin/notify` (broadcasts — removed from co-host)
- `/admin/messages` (guest messaging — admin only)
- Booking codes or guest link URLs anywhere
- Financial data anywhere
- Team management controls

### Updated Co-Host Allowed Routes
```js
cohost: {
  allowedRoutes: [
    '/admin',           // operations dashboard
    '/admin/stays',     // filtered current stays (NEW)
    '/admin/assignments', // admin-assigned tasks (NEW)
    '/admin/maintenance',
    '/admin/calendar',
    '/admin/cleaning',
  ],
  defaultRedirect: '/admin',
}
```

**Removed**: `/admin/bookings`, `/admin/messages`, `/admin/notify`

---

## 4. Recommended Admin Todo / Assignment System

### Where It Lives
New admin page: `/admin/assignments`

This page has two views:
1. **Board view** (default): Kanban-style columns — Pending | In Progress | Done
2. **List view**: Sortable table for dense information

### How Admin Creates a Task

**Create Task Form** (modal or inline):
| Field | Required | Type | Notes |
|-------|----------|------|-------|
| Title | Yes | text (max 120 chars) | Short, actionable: "Check if guest left charger in Unit A" |
| Description | No | textarea (max 500 chars) | Additional context, instructions |
| Assignee | Yes | select | Dropdown of active co-hosts (future: any staff member) |
| Due Date | No | date picker | Optional deadline |
| Priority | Yes | select | Low / Medium / High (default: Medium) |
| Property/Unit | No | select | Unit A / Unit B / Shared / None |
| Template | No | select | Load from saved checklist template (see below) |

### Assignment Flow
1. Admin opens `/admin/assignments` → clicks "New Task"
2. Admin fills form, selects assignee, clicks "Create"
3. Task is created with status `pending`
4. Assignee receives push notification + SMS fallback: "New task: {title}"
5. Task appears in assignee's Assignments view

### Task Statuses
```
pending → in_progress → completed
                      → cancelled (admin only)
```

### How Co-Host is Notified
- **Push notification** (FCM) with title "New Assignment" and task title
- **SMS fallback** if no FCM token registered
- **In-app badge** on the Assignments nav item showing count of pending tasks

### How Completion is Tracked
- Co-host marks task "Done" with optional completion note
- Admin receives push notification: "{co-host name} completed: {task title}"
- Task moves to "Done" column with timestamp and completion note
- Admin can reopen if not satisfied (status back to `pending`)

### Checklist Templates — Hybrid Approach

**Recommendation: Start with simple tasks. Add templates in Phase 2.**

Phase 1 (MVP):
- Individual tasks with all fields above
- No templates, no recurring tasks
- Simple and fast to ship

Phase 2 (Enhancement):
- **Checklist templates**: Saved task groups like "Turnover Checklist" with predefined items:
  - Check towels restocked
  - Check dishes clean
  - Check trash emptied
  - Check linens fresh
  - Inspect bathrooms
- Admin selects template → system creates individual tasks for each item
- Templates are admin-editable in `/admin/settings`

Phase 3 (Future):
- **Recurring tasks**: Auto-create from template on schedule (e.g., weekly "Inspect fire extinguishers")
- **Task photos**: Assignee can attach photo proof to completion

---

## 5. Recommended Cleaner Experience

### Design Principles
- Spanish-first, English available as toggle
- One screen at a time (wizard pattern)
- Large touch targets (min 48px, prefer 56px)
- Minimal text input — use buttons, toggles, photo capture
- No navigation chrome — just the current step
- Impossible to get lost

### Cleaner Home Screen
When the cleaner logs in, they see ONE of two states:

**State A — No Active Job**
```
┌─────────────────────────┐
│  Casa Coqui             │
│  Limpieza          [ES] │
├─────────────────────────┤
│                         │
│  Próximas Limpiezas     │
│                         │
│  ┌───────────────────┐  │
│  │ Unit A             │  │
│  │ Mar 15, 2026       │  │
│  │ Checkout: 11:00 AM │  │
│  │                    │  │
│  │ [  Confirmar  ]    │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ Unit B             │  │
│  │ Mar 17, 2026       │  │
│  │ Checkout: 11:00 AM │  │
│  │                    │  │
│  │ [  Confirmar  ]    │  │
│  └───────────────────┘  │
│                         │
└─────────────────────────┘
```

**State B — Active Job Today**
```
┌─────────────────────────┐
│  Limpieza Hoy           │
│  Unit A                 │
├─────────────────────────┤
│                         │
│  ┌───────────────────┐  │
│  │                    │  │
│  │  [Voy en Camino]  │  │
│  │                    │  │
│  │     (big button)   │  │
│  │                    │  │
│  └───────────────────┘  │
│                         │
│  Notas:                 │
│  "Guest checking in     │
│   at 3 PM today"        │
│                         │
└─────────────────────────┘
```

### Cleaning Wizard Steps

Each step is a full-screen view with ONE primary action.

**Step 1: Confirmar (Acknowledge)**
- Shown when a new cleaning is scheduled
- "Nueva limpieza programada"
- Shows: unit, date, checkout time, turnover notes
- Button: `[Confirmar]` (I acknowledge this job)
- → Notifies admin + co-host

**Step 2: Voy en Camino (En Route)**
- Shown on cleaning day
- One large button: `[Voy en Camino]`
- → Notifies admin + co-host
- → Advances to Step 3

**Step 3: Llegué (Arrived)**
- Button: `[Llegué]` (I've arrived)
- → Notifies admin + co-host
- → Advances to Step 4

**Step 4: Fotos de Antes (Before Photos)**
- Camera button to take/upload 1-4 photos
- Photos upload to Firebase Storage
- Button: `[Continuar]` (after at least 1 photo)
- → Advances to Step 5

**Step 5: Limpiando... (Cleaning in Progress)**
- Status screen showing "Limpieza en progreso"
- Two buttons:
  - `[Reportar Problema]` → opens issue report (Step 5b)
  - `[Listo para Fotos]` → advances to Step 6

**Step 5b: Reportar Problema (Issue Report)**
- Photo capture (optional)
- Category buttons: Daño (Damage) | Faltante (Missing item) | Reparación (Repair needed) | Otro (Other)
- Short text description (optional)
- Button: `[Enviar Reporte]`
- → Notifies admin + co-host immediately
- → Returns to Step 5

**Step 6: Fotos de Después (After Photos)**
- Camera button to take/upload 1-4 photos
- Button: `[Continuar]`
- → Advances to Step 7

**Step 7: Lavandería (Laundry Check)**
- "¿Se encontró algo en la lavadora o secadora?"
- Two large buttons:
  - `[No, todo limpio]` (No, all clean)
  - `[Sí, se encontró algo]` (Yes, something found)
- If "Sí": photo capture + short description
- → Notifies admin if something found
- → Advances to Step 8

**Step 8: Completado (Done)**
- Confirmation screen
- "¡Limpieza completada!"
- Summary: unit, time started, time completed, photos taken, issues reported
- Button: `[Terminar]`
- → Notifies admin + co-host
- → Returns to home screen (State A)

### Cleaning Job Lifecycle (State Machine)
```
scheduled → acknowledged → en_route → arrived → before_photos → cleaning → after_photos → laundry_check → completed
                                                                    ↓
                                                              issue_reported (does not block flow)
```

---

## 6. Spanish Language Recommendations

### Cleaner Flow Labels

| English | Spanish | Context |
|---------|---------|---------|
| My Cleanings | Mis Limpiezas | Nav/header |
| Upcoming Cleanings | Próximas Limpiezas | Job list heading |
| Today's Cleaning | Limpieza de Hoy | Active job heading |
| Confirm | Confirmar | Acknowledge button |
| On My Way | Voy en Camino | En route button |
| I've Arrived | Llegué | Arrival button |
| Before Photos | Fotos de Antes | Step heading |
| Take Photo | Tomar Foto | Camera button |
| Continue | Continuar | Next step button |
| Cleaning in Progress | Limpieza en Progreso | Status message |
| Report Issue | Reportar Problema | Issue button |
| Damage | Daño | Issue category |
| Missing Item | Faltante | Issue category |
| Repair Needed | Reparación | Issue category |
| Other | Otro | Issue category |
| Send Report | Enviar Reporte | Submit issue |
| After Photos | Fotos de Después | Step heading |
| Laundry Check | Revisión de Lavandería | Step heading |
| Was anything found in the washer or dryer? | ¿Se encontró algo en la lavadora o secadora? | Laundry question |
| No, all clean | No, todo limpio | Laundry answer |
| Yes, something found | Sí, se encontró algo | Laundry answer |
| Cleaning Complete! | ¡Limpieza Completada! | Success message |
| Finish | Terminar | Final button |
| Sign Out | Cerrar Sesión | Sign out button |
| Unit | Unidad | Unit label |
| Date | Fecha | Date label |
| Checkout Time | Hora de Salida | Time label |
| Notes | Notas | Notes label |
| Supply Request | Solicitud de Suministro | Supply request |
| Request Supplies | Solicitar Suministros | Supply button |

### Implementation Approach
**Do NOT use a full i18n library.** For this use case, a simple locale context is sufficient:

```js
// lib/i18n.js
const translations = {
  es: { /* all Spanish strings */ },
  en: { /* all English strings */ },
};

// hooks/useLocale.js — reads from localStorage, defaults to 'es' for cleaner role
```

The cleaner shell defaults to `es`. A small toggle in the header allows switching to `en`. Admin and co-host remain English-only.

---

## 7. Permission Matrix

| Resource | Admin | Co-host | Cleaner | Maintenance | Guest |
|----------|-------|---------|---------|-------------|-------|
| **Bookings — create** | FULL | DENY | DENY | DENY | DENY |
| **Bookings — view all** | FULL | DENY | DENY | DENY | DENY |
| **Current stays — view** | FULL | FILTERED (name, unit, dates only) | DENY | DENY | Own booking only |
| **Calendar — view** | FULL | READ-ONLY | DENY | DENY | DENY |
| **Tasks/Todos — create** | FULL | DENY | DENY | DENY | DENY |
| **Tasks/Todos — view assigned** | FULL (all) | Own tasks | Own tasks | Own tasks | DENY |
| **Tasks/Todos — update status** | FULL | Own tasks | Own tasks | Own tasks | DENY |
| **Maintenance — view** | FULL | READ | DENY | Assigned only | Own requests |
| **Maintenance — create** | FULL | DENY | Issue reports only | DENY | FULL |
| **Maintenance — update status** | FULL | Add notes only | DENY | FULL | DENY |
| **Cleaning workflow — view** | FULL (all jobs) | READ (status only) | Own jobs only | DENY | DENY |
| **Cleaning workflow — update** | FULL | DENY | Own jobs only | DENY | DENY |
| **Community board — view** | FULL | READ | DENY | DENY | FULL |
| **Direct messaging (guests)** | FULL | DENY | DENY | DENY | To host only |
| **Broadcast notifications** | FULL | DENY | DENY | DENY | DENY |
| **Staff messaging** | FULL | To admin only | Issue reports only | Via maintenance notes | DENY |
| **Team management** | FULL | DENY | DENY | DENY | DENY |
| **Settings** | FULL | DENY | DENY | DENY | DENY |
| **Expenses** | FULL | DENY | DENY | DENY | DENY |
| **Revenue** | FULL | DENY | DENY | DENY | DENY |
| **Receipts** | FULL | DENY | DENY | DENY | DENY |
| **Supplies — manage** | FULL | DENY | DENY | DENY | DENY |
| **Supplies — request** | FULL | DENY | Request only | DENY | DENY |
| **Notifications — receive** | Task completions, cleaning updates, maintenance, issues | Task assignments, cleaning updates, issues | New job assignments | New maintenance assignments | Broadcasts, direct messages |

---

## 8. Technical Findings

### Current Behavior
- 4 roles defined in `lib/roles.js` with route-level allowlists
- Admin layout filters nav items based on `canAccessRoute(role, pathname)`
- Cleaner/maintenance get a simplified header-only shell
- Co-host shares the full admin shell with fewer nav items
- 7 of 23 API routes are properly auth-protected
- Firestore security rules provide a second layer for client-side operations
- Role is stored in both Firestore `users/{uid}` doc AND Firebase Auth custom claims
- Guest auth uses phone OTP → custom claims with `bookingCode`

### Security Risks

| Risk | File(s) | Detail |
|------|---------|--------|
| `POST /api/bookings` — no auth | `app/api/bookings/route.js` | Anyone can create bookings on the internet |
| `GET /api/bookings` — no auth | `app/api/bookings/route.js` | All bookings (guest names, link codes) exposed |
| `GET/POST/DELETE /api/expenses` — no auth | `app/api/expenses/route.js` | Full financial CRUD is public |
| `GET/POST/DELETE /api/revenue` — no auth | `app/api/revenue/route.js` | Full revenue CRUD is public |
| `GET/POST/PATCH/DELETE /api/supplies` — no auth | `app/api/supplies/route.js` | Full inventory CRUD is public |
| `GET /api/notifications` — no auth | `app/api/notifications/route.js` | All notification history exposed |
| `POST /api/email/guest-link` — no auth | `app/api/email/guest-link/route.js` | Anyone can send emails from Casa Coqui domain |
| `GET /api/receipts/[month]` — no auth | `app/api/receipts/[month]/route.js` | Receipt URLs and financial data exposed |
| `POST /api/receipts/inbound` — no webhook verification | `app/api/receipts/inbound/route.js` | Fake receipts can be injected |
| `POST /api/maintenance` — bookingCode not validated | `app/api/maintenance/route.js` | Guest can file request under wrong booking |
| `POST /api/messages/notify` — sender not validated | `app/api/messages/notify/route.js` | Guest could trigger notification as "host" |
| No middleware.js | (missing) | No edge-level route protection |
| Dual role source of truth | `lib/api-auth.js` vs Firestore rules | API reads role from Firestore doc; rules read from custom claims |
| `cleanings` collection has no Firestore rules | `firestore.rules` | Missing security rule for cleaning documents |
| `supply_requests` collection has no Firestore rules | `firestore.rules` | Missing security rule for supply request documents |

### Missing Protections
- No rate limiting on any API endpoint
- No CSRF protection beyond Next.js defaults
- No audit logging for sensitive operations (booking creation, financial changes)
- No webhook signature verification on receipt inbound endpoint
- No validation that co-host calling `/api/notifications/broadcast` should actually be able to broadcast
- Admin invite endpoint returns `resetLink` in response body (potential log exposure)

### UX Risks
- Co-host sees full booking details including guest link codes — privacy leak
- Cleaner page is designed for admin operations, not cleaner workflow
- No Spanish support for any role
- `usePush` hook is never integrated — all notifications go through paid SMS
- No `firebase-messaging-sw.js` — background push would fail even if integrated
- Supply requests from cleaners have no admin resolution UI
- No notification when maintenance requests are created or status-updated

### Recommended Changes
See sections 9-15 below for the complete implementation plan.

---

## 9. Technical Implementation Plan

### Phase 0: Security Hardening (MUST DO FIRST)

#### Backend/API Changes
Add `requireRole` to every unprotected endpoint:

| Endpoint | Required Role(s) |
|----------|------------------|
| `GET /api/bookings` | `admin` |
| `POST /api/bookings` | `admin` |
| `GET /api/expenses` | `admin` |
| `POST /api/expenses` | `admin` |
| `DELETE /api/expenses` | `admin` |
| `GET /api/revenue` | `admin` |
| `POST /api/revenue` | `admin` |
| `DELETE /api/revenue` | `admin` |
| `GET /api/supplies` | `admin` |
| `POST /api/supplies` | `admin` |
| `PATCH /api/supplies` | `admin` |
| `DELETE /api/supplies` | `admin` |
| `GET /api/supplies/reorder` | `admin` |
| `GET /api/notifications` | `admin`, `cohost` (or make guest-facing with scoped data) |
| `POST /api/email/guest-link` | `admin` |
| `GET /api/receipts/[month]` | `admin` |
| `GET/POST /api/laundry` | any authenticated (keep open for guests) |

#### Auth/Permission Changes
1. Add Next.js `middleware.js` at project root:
   - Verify Firebase session cookie or redirect to login for all `/admin/*` routes (except `/admin/login`)
   - Optionally validate role at edge for hard blocks

2. Standardize auth pattern in `/api/admin/invite/route.js` to use `requireRole(request, ['admin'])` instead of inline auth logic

3. Add `bookingCode` validation in `POST /api/maintenance` — verify caller's claim matches body's bookingCode

4. Add `sender` validation in `POST /api/messages/notify` — verify caller role matches sender field

#### Firestore Rules Updates
Add rules for:
- `cleanings` — staff can read/write, guests denied
- `supply_requests` — staff can read/write, guests denied

### Phase 1: Co-Host Operational View

#### New API Endpoints
1. `GET /api/stays/active` — returns filtered active stays for co-host
   - Role: `admin`, `cohost`
   - Returns: `{ unit, guestFirstName, checkInDate, checkOutDate, status }`
   - Excludes: bookingCode, guestLink, guestPhone, guestEmail

2. `GET /api/assignments` — returns tasks assigned to the caller
   - Role: any staff
   - Filter by `assigneeId` === caller.uid
   - Returns all task fields

3. `POST /api/assignments` — create new task
   - Role: `admin` only
   - Body: `{ title, description, assigneeId, dueDate, priority, unit }`

4. `PATCH /api/assignments/[id]` — update task status
   - Role: `admin` (any field), assignee (status and completionNote only)

5. `DELETE /api/assignments/[id]` — cancel/delete task
   - Role: `admin` only

#### Frontend Changes
1. New page: `/admin/stays/page.js` — filtered stays view for co-host
2. New page: `/admin/assignments/page.js` — dual-purpose:
   - Admin sees: all assignments + create form + board view
   - Co-host sees: own assignments only + status update buttons
3. Update `lib/roles.js`:
   - Remove from cohost: `/admin/bookings`, `/admin/messages`, `/admin/notify`
   - Add to cohost: `/admin/stays`, `/admin/assignments`
4. Update admin dashboard (`/admin/page.js`):
   - Co-host variant shows operational summary instead of full admin stats
5. Update `app/admin/maintenance/page.js`:
   - Co-host can add notes but cannot change status to "done"

#### Backend Authorization Changes
1. Remove `cohost` from `POST /api/notifications/broadcast` allowed roles
2. Remove `cohost` from `POST /api/notifications/direct` allowed roles
3. Add role-based field filtering in maintenance GET (hide guest contact details for co-host)

### Phase 2: Admin Assignment System

#### New Firestore Collection: `assignments`
(See Data Model section below)

#### Admin UI
1. `/admin/assignments` page with:
   - Board view: Kanban columns (Pending | In Progress | Done)
   - Create task modal with form fields
   - Assignee dropdown populated from `users` collection where `status === 'active'` and `role in ['cohost']`
   - Task cards with priority badges, due dates, assignee avatar
   - Click to expand: full task detail with notes and history

#### Notification Integration
1. On task creation: notify assignee via FCM + SMS
2. On task completion: notify admin via FCM + SMS
3. On task reopened: notify assignee via FCM + SMS

### Phase 3: Cleaner Wizard Experience

#### New API Endpoints
1. `GET /api/cleaning/jobs` — returns cleaning jobs assigned to caller
   - Role: `admin`, `cohost`, `cleaner`
   - Cleaner: only own jobs; Admin/cohost: all jobs

2. `POST /api/cleaning/jobs` — create cleaning job (admin only)
   - Triggered when booking checkout approaches or manually by admin
   - Body: `{ unit, scheduledDate, checkoutTime, assigneeId, notes }`

3. `PATCH /api/cleaning/jobs/[id]` — update job status
   - Role: `admin` (any field), `cleaner` (own jobs, status transitions only)
   - Validates state machine transitions

4. `POST /api/cleaning/jobs/[id]/photos` — upload photo references
   - Role: `cleaner` (own jobs only)
   - Body: `{ type: 'before' | 'after' | 'issue' | 'laundry', urls: [] }`

5. `POST /api/cleaning/jobs/[id]/issues` — report issue during cleaning
   - Role: `cleaner` (own jobs only)
   - Body: `{ category, description, photoUrl }`

#### Frontend Changes
1. New cleaner shell: `/app/admin/cleaning/layout.js` — replaces simplified header with Spanish-first mobile shell
2. Rewrite `/admin/cleaning/page.js`:
   - If `role === 'cleaner'`: show wizard experience
   - If `role === 'admin'` or `role === 'cohost'`: show admin cleaning dashboard
3. Wizard component: `components/cleaner/CleaningWizard.js`
4. Step components: `components/cleaner/steps/`
   - `Acknowledge.js`
   - `EnRoute.js`
   - `Arrived.js`
   - `BeforePhotos.js`
   - `Cleaning.js`
   - `IssueReport.js`
   - `AfterPhotos.js`
   - `LaundryCheck.js`
   - `Complete.js`
5. Spanish translations: `lib/i18n.js`
6. Locale hook: `hooks/useLocale.js`

### Phase 4: Property-Scoped Access

#### Database Changes
1. Add `propertyId` field to: `bookings`, `maintenance`, `cleaning_jobs`, `assignments`, `expenses`, `revenue`, `supplies`
2. For now, all records get `propertyId: 'casa-coqui'` (single property)
3. Add `properties` array to `users` collection for staff: `['casa-coqui']`

#### API Changes
1. All list endpoints filter by `propertyId` based on caller's `properties` array
2. All create endpoints set `propertyId` from caller's context

#### Future: Multi-Property
When a second property is added, the scoping layer is already in place. Staff can be assigned to one or more properties.

### Phase 5: FCM Integration

1. Import `usePush` in guest layout and admin layout
2. Create `public/firebase-messaging-sw.js` for background push
3. Register staff FCM tokens with `bookingCode: 'staff:{uid}'`
4. Update notification library to send push to staff members
5. Add notification preferences collection (optional)

---

## 10. Data Model Recommendations

### `assignments` (NEW Collection)
```
{
  id:              string (auto)
  title:           string (max 120 chars)
  description:     string (max 500 chars, optional)
  assigneeId:      string (Firebase Auth UID)
  assigneeName:    string (denormalized for display)
  assigneeRole:    string ('cohost' | 'cleaner')
  createdBy:       string (admin UID)
  createdByName:   string (denormalized)
  status:          string ('pending' | 'in_progress' | 'completed' | 'cancelled')
  priority:        string ('low' | 'medium' | 'high')
  dueDate:         string (ISO date, optional)
  unit:            string ('Unit A' | 'Unit B' | 'Shared' | null)
  propertyId:      string ('casa-coqui')
  completionNote:  string (optional, set by assignee on completion)
  completedAt:     string (ISO timestamp, set on completion)
  createdAt:       string (ISO timestamp)
  updatedAt:       string (ISO timestamp)
}
```

### `cleaning_jobs` (NEW Collection)
```
{
  id:              string (auto)
  unit:            string ('Unit A' | 'Unit B')
  propertyId:      string ('casa-coqui')
  scheduledDate:   string (ISO date)
  checkoutTime:    string ('11:00 AM')
  assigneeId:      string (cleaner UID)
  assigneeName:    string (denormalized)
  bookingId:       string (optional, links to departing booking)
  status:          string (see lifecycle below)
  notes:           string (admin notes for cleaner)
  turnoverNotes:   string (special instructions)
  sameDay Arrival: boolean (is there a guest checking in today?)
  beforePhotos:    string[] (Storage URLs)
  afterPhotos:     string[] (Storage URLs)
  issues:          array of { category, description, photoUrl, reportedAt }
  laundryFound:    boolean | null
  laundryNote:     string (optional)
  laundryPhoto:    string (optional Storage URL)
  acknowledgedAt:  string (ISO timestamp)
  enRouteAt:       string (ISO timestamp)
  arrivedAt:       string (ISO timestamp)
  startedAt:       string (ISO timestamp)
  completedAt:     string (ISO timestamp)
  createdAt:       string (ISO timestamp)
  createdBy:       string (admin UID)
}
```

**Status values**: `scheduled` | `acknowledged` | `en_route` | `arrived` | `before_photos` | `cleaning` | `after_photos` | `laundry_check` | `completed`

### `staff_notifications` (NEW Collection)
```
{
  id:              string (auto)
  recipientId:     string (staff UID)
  recipientRole:   string
  type:            string ('task_assigned' | 'task_reopened' | 'cleaning_scheduled' |
                           'cleaning_status' | 'issue_reported' | 'task_completed' |
                           'maintenance_new' | 'cleaning_completed')
  title:           string
  message:         string
  referenceType:   string ('assignment' | 'cleaning_job' | 'maintenance')
  referenceId:     string (doc ID of related entity)
  read:            boolean (false)
  createdAt:       string (ISO timestamp)
}
```

### `users` (UPDATED — add fields)
```
{
  // existing fields...
  email:           string
  role:            string
  displayName:     string
  status:          string
  // new fields:
  phone:           string (for SMS notifications)
  properties:      string[] (['casa-coqui'])
  locale:          string ('en' | 'es', default based on role)
}
```

### Firestore Rules for New Collections
```
match /assignments/{assignmentId} {
  allow read: if isStaff() && (
    isAdmin() || resource.data.assigneeId == request.auth.uid
  );
  allow create: if isAdmin();
  allow update: if isAdmin() || (
    isStaff() &&
    resource.data.assigneeId == request.auth.uid &&
    request.resource.data.diff(resource.data).affectedKeys()
      .hasOnly(['status', 'completionNote', 'completedAt', 'updatedAt'])
  );
  allow delete: if isAdmin();
}

match /cleaning_jobs/{jobId} {
  allow read: if isStaff() && (
    isAdmin() || resource.data.assigneeId == request.auth.uid
  );
  allow create: if isAdmin();
  allow update: if isAdmin() || (
    isStaff() &&
    resource.data.assigneeId == request.auth.uid
  );
  allow delete: if isAdmin();
}

match /staff_notifications/{notifId} {
  allow read: if isStaff() && resource.data.recipientId == request.auth.uid;
  allow create: if isAdmin() || isStaff();
  allow update: if isStaff() && resource.data.recipientId == request.auth.uid;
  allow delete: if false;
}
```

---

## 11. Booking Restriction Plan

### Goal: Guarantee co-host CANNOT create bookings

#### Layer 1 — UI Restrictions
- Remove `/admin/bookings` from co-host's `allowedRoutes` in `lib/roles.js`
- Co-host nav will not show "Bookings" tab
- Replace with `/admin/stays` (read-only filtered view)
- No "Create Booking" button visible anywhere in co-host's experience

#### Layer 2 — Backend Authorization
- Add `requireRole(request, ['admin'])` to `POST /api/bookings`
- This is the **real** security boundary — even if UI is bypassed, the API rejects

#### Layer 3 — Direct URL Prevention
- Admin layout's `canAccessRoute()` check redirects co-host away from `/admin/bookings`
- If co-host manually types `/admin/bookings` in browser, they are redirected to `/admin` (their default)

#### Layer 4 — API Protection
- `POST /api/bookings` returns 403 for any non-admin caller
- `GET /api/bookings` returns 403 for any non-admin caller (co-host uses `/api/stays/active` instead)

#### Layer 5 — Privilege Escalation Prevention
- `POST /api/admin/invite` only allows admin to invite
- `PATCH /api/admin/team/[uid]` only allows admin to change roles
- A co-host cannot promote themselves to admin
- A co-host cannot invite new team members
- The role change endpoint validates that the new role is in `INVITABLE_ROLES` (cannot set to 'admin')
- Custom claims AND Firestore doc are updated together — no split-brain

#### Layer 6 — Next.js Middleware (defense in depth)
- `middleware.js` at project root validates auth token on every `/admin/*` request
- Returns 401/redirect before the page component even loads
- This prevents the brief flash of content that currently occurs during client-side redirect

---

## 12. Admin-to-Co-Host Assignment Plan

### Complete Workflow

```
ADMIN                                    CO-HOST
  │                                        │
  ├─ Opens /admin/assignments              │
  │                                        │
  ├─ Clicks "New Task"                     │
  │  ├─ Fills title, description           │
  │  ├─ Selects assignee (co-host)         │
  │  ├─ Sets due date (optional)           │
  │  ├─ Sets priority (low/med/high)       │
  │  ├─ Clicks "Create"                    │
  │                                        │
  ├─ POST /api/assignments                 │
  │  ├─ Creates doc in `assignments`       │
  │  ├─ Sends FCM push to co-host          │
  │  ├─ SMS fallback if no FCM token       │
  │  └─ Creates staff_notification doc     │
  │                                        │
  │                                    ←── Co-host receives notification
  │                                        │
  │                                        ├─ Opens /admin/assignments
  │                                        │  (sees own tasks only)
  │                                        │
  │                                        ├─ Clicks "Start" on task
  │                                        │  PATCH /api/assignments/{id}
  │                                        │  status: 'in_progress'
  │                                        │
  │                                        ├─ Does the work...
  │                                        │
  │                                        ├─ Clicks "Done"
  │                                        │  PATCH /api/assignments/{id}
  │                                        │  status: 'completed'
  │                                        │  completionNote: "Done, charger found"
  │                                        │
  ├─ Admin receives notification  ←────────┤
  │  "Maria completed: Check for charger"  │
  │                                        │
  ├─ Admin sees task in "Done" column      │
  │  with completion note + timestamp      │
  │                                        │
  ├─ (Optional) Admin reopens task         │
  │  PATCH status: 'pending'               │
  │  Co-host gets re-notification  ──────→ │
  │                                        │
```

### API Authorization Matrix for Assignments

| Action | Admin | Co-host | Cleaner | Maintenance |
|--------|-------|---------|---------|-------------|
| List all tasks | YES | Own only | Own only | Own only |
| Create task | YES | NO | NO | NO |
| Update any field | YES | NO | NO | NO |
| Update own task status | YES | YES | YES | YES |
| Delete/cancel task | YES | NO | NO | NO |

---

## 13. Notification Plan

### All Notification Events

| Event | Trigger | Recipients | Channel | Message |
|-------|---------|------------|---------|---------|
| **Task assigned** | Admin creates assignment | Assignee | FCM + SMS | "Nueva tarea: {title}" / "New task: {title}" |
| **Task completed** | Assignee marks done | Admin | FCM + SMS | "{name} completó: {title}" |
| **Task reopened** | Admin sets back to pending | Assignee | FCM + SMS | "Tarea reabierta: {title}" |
| **Cleaning scheduled** | Admin creates cleaning job | Assigned cleaner | FCM + SMS | "Nueva limpieza: {unit} - {date}" |
| **Cleaner acknowledged** | Cleaner taps Confirmar | Admin + co-host | FCM + SMS | "{name} confirmó limpieza: {unit}" |
| **Cleaner en route** | Cleaner taps Voy en Camino | Admin + co-host | FCM + SMS | "{name} va en camino: {unit}" |
| **Cleaner arrived** | Cleaner taps Llegué | Admin + co-host | FCM + SMS | "{name} llegó: {unit}" |
| **Issue reported** | Cleaner reports issue | Admin + co-host | FCM + SMS | "Problema reportado: {unit} - {category}" |
| **Laundry item found** | Cleaner reports laundry find | Admin + co-host | FCM + SMS | "Artículo encontrado en lavandería: {unit}" |
| **Cleaning completed** | Cleaner finishes wizard | Admin + co-host | FCM + SMS | "Limpieza completada: {unit}" |
| **Maintenance created** | Guest submits request | Admin + maintenance staff | FCM + SMS | "New maintenance request: {category}" |
| **Maintenance updated** | Admin/maintenance updates | Guest who submitted | FCM + SMS | "Your maintenance request was updated" |
| **Guest message** | Guest sends chat message | Admin | FCM + SMS | "New message from {guestName}" |
| **Host reply** | Admin replies to guest | Guest | FCM + SMS | "New message from host" |
| **Broadcast** | Admin sends broadcast | All active guests | FCM + SMS | Custom message |
| **Parking alert** | Guest reports parking | All active guests | FCM + SMS | Generic parking alert |
| **Supply reorder** | Scheduled Cloud Function | Admin | FCM + SMS | "Low stock alert: {items}" |

### Implementation: Staff Notification Helper

```js
// lib/staff-notifications.js
export async function notifyStaff({ recipientIds, type, title, message, referenceType, referenceId }) {
  // 1. Create staff_notification docs for each recipient
  // 2. Look up FCM tokens for each recipient
  // 3. Send FCM push to each
  // 4. SMS fallback for recipients without tokens
}

export async function notifyAdminAndCohost({ type, title, message, referenceType, referenceId }) {
  // Query users where role in ['admin', 'cohost'] and status === 'active'
  // Call notifyStaff with their UIDs
}
```

---

## 14. QA / Test Plan

### Co-Host Tests

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 1 | Co-host login | Login with co-host email/password | Redirects to `/admin` dashboard |
| 2 | Co-host sees filtered nav | Check bottom nav items | Sees: Dashboard, Stays, Assignments, More (Maintenance, Calendar, Cleaning) |
| 3 | Co-host does NOT see admin pages | Check nav | No: Bookings, Messages, Broadcast, Expenses, Supplies, Receipts, Revenue, Settings, Team |
| 4 | Co-host stays view is filtered | Open `/admin/stays` | Sees unit, first name, dates. No booking codes, links, phone, email |
| 5 | Co-host cannot create booking via URL | Navigate to `/admin/bookings` | Redirected to `/admin` |
| 6 | Co-host cannot create booking via API | `POST /api/bookings` with co-host token | Returns 403 |
| 7 | Co-host sees assigned tasks | Open `/admin/assignments` | Sees only own tasks |
| 8 | Co-host cannot create tasks | Check assignments page | No "New Task" button |
| 9 | Co-host cannot create tasks via API | `POST /api/assignments` with co-host token | Returns 403 |
| 10 | Co-host updates task status | Click "Start" then "Done" on task | Status updates, admin notified |
| 11 | Co-host cannot send broadcast | `POST /api/notifications/broadcast` | Returns 403 |
| 12 | Co-host cannot send direct message | `POST /api/notifications/direct` | Returns 403 |
| 13 | Co-host maintenance is read + notes only | Open maintenance request | Can add notes, cannot change status |
| 14 | Co-host calendar is read-only | Open `/admin/calendar` | No create/edit affordances |

### Admin Assignment Tests

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 15 | Admin creates task | Fill form, select co-host, click Create | Task created, co-host notified |
| 16 | Admin sees all tasks | Open `/admin/assignments` | Sees tasks for all assignees |
| 17 | Admin cancels task | Click cancel on task | Status → cancelled, removed from co-host view |
| 18 | Admin reopens task | Click reopen on completed task | Status → pending, co-host re-notified |
| 19 | Task due date badge | Create task with past due date | Shows overdue indicator |
| 20 | Task priority display | Create high priority task | Shows red priority badge |

### Cleaner Tests

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 21 | Cleaner login | Login with cleaner email/password | Redirects to `/admin/cleaning` |
| 22 | Cleaner sees Spanish-first UI | Check page language | All labels in Spanish |
| 23 | Cleaner sees only cleaning jobs | Check available pages | Only cleaning page, no nav to other pages |
| 24 | Cleaner cannot access admin pages | Navigate to `/admin/bookings` | Redirected to `/admin/cleaning` |
| 25 | Cleaner cannot access admin API | `GET /api/bookings` with cleaner token | Returns 403 |
| 26 | Cleaner receives cleaning notification | Admin creates cleaning job | Cleaner gets push/SMS |
| 27 | Cleaner acknowledges cleaning | Tap "Confirmar" | Status → acknowledged, admin + co-host notified |
| 28 | Cleaner full wizard flow | Complete all steps | Status transitions correctly at each step |
| 29 | Cleaner before photos required | Try to advance without photo | Cannot proceed |
| 30 | Cleaner issue report | Report issue during cleaning | Admin + co-host notified, issue logged |
| 31 | Cleaner laundry found | Select "Sí, se encontró algo" | Photo prompt, admin notified |
| 32 | Cleaner completion | Finish wizard | Status → completed, admin + co-host notified |
| 33 | Cleaner cannot modify completed job | Attempt status change after completion | Rejected |
| 34 | Cleaner supply request | Submit supply request | Request created with pending status |

### Property-Scoped Access Tests

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 35 | Staff sees only assigned property data | Query with property filter | Only matching property results |
| 36 | Wrong property access blocked | API call with different propertyId | Returns 403 or empty results |

### Cross-Role Security Tests

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 37 | Unauthenticated API access | Call any protected endpoint without token | Returns 401 |
| 38 | Wrong role API access | Call admin-only endpoint with cleaner token | Returns 403 |
| 39 | Co-host cannot invite team | `POST /api/admin/invite` with co-host token | Returns 403 |
| 40 | Co-host cannot change roles | `PATCH /api/admin/team/{uid}` with co-host token | Returns 403 |
| 41 | Cleaner cannot see other cleaner's jobs | Query cleaning_jobs with cleaner token | Only own jobs returned |
| 42 | Guest cannot access staff endpoints | Call `/api/assignments` with guest token | Returns 403 |

---

## 15. Copy-Paste Engineering Tickets

### Ticket 1: Secure All Unprotected API Routes
**Priority**: P0 — CRITICAL (security blocker)
**Effort**: Small (2-3 hours)
**Dependencies**: None

**Description**:
Add `requireRole` authorization to all 11 currently unprotected API endpoints. This is a production security vulnerability where financial data, bookings, and email sending are fully public.

**Acceptance Criteria**:
- [ ] `GET /api/bookings` requires `admin` role
- [ ] `POST /api/bookings` requires `admin` role
- [ ] `GET/POST/DELETE /api/expenses` requires `admin` role
- [ ] `GET/POST/DELETE /api/revenue` requires `admin` role
- [ ] `GET/POST/PATCH/DELETE /api/supplies` requires `admin` role
- [ ] `GET /api/supplies/reorder` requires `admin` role
- [ ] `POST /api/email/guest-link` requires `admin` role
- [ ] `GET /api/receipts/[month]` requires `admin` role
- [ ] `GET /api/notifications` requires `admin` or `cohost` role (or scope to guest-visible data for authenticated guests)
- [ ] `GET/POST /api/laundry` requires any authenticated user (`requireAuth`)
- [ ] Standardize `/api/admin/invite` to use `requireRole(request, ['admin'])` instead of inline auth
- [ ] Add `bookingCode` claim validation in `POST /api/maintenance`
- [ ] Add `sender` role validation in `POST /api/messages/notify`
- [ ] All protected endpoints return consistent 401/403 JSON responses
- [ ] Verified via manual curl testing with no token, guest token, cohost token, admin token

**Files to modify**:
- `app/api/bookings/route.js`
- `app/api/expenses/route.js`
- `app/api/revenue/route.js`
- `app/api/supplies/route.js`
- `app/api/supplies/reorder/route.js`
- `app/api/email/guest-link/route.js`
- `app/api/receipts/[month]/route.js`
- `app/api/notifications/route.js`
- `app/api/laundry/route.js`
- `app/api/admin/invite/route.js`
- `app/api/maintenance/route.js`
- `app/api/messages/notify/route.js`

---

### Ticket 2: Add Next.js Middleware for Route Protection
**Priority**: P0 — CRITICAL (defense in depth)
**Effort**: Small (1-2 hours)
**Dependencies**: None

**Description**:
Create `middleware.js` at project root to verify Firebase auth tokens on all `/admin/*` routes at the edge level. This prevents the brief flash of admin content before client-side redirect, and provides a security layer independent of individual page components.

**Acceptance Criteria**:
- [ ] `middleware.js` exists at project root
- [ ] All `/admin/*` routes (except `/admin/login`) require a valid Firebase session
- [ ] Unauthenticated requests to `/admin/*` are redirected to `/admin/login`
- [ ] API routes (`/api/*`) are NOT affected (they have their own auth)
- [ ] Guest routes (`/g/*`) are NOT affected
- [ ] Static assets are NOT affected

**Implementation Notes**:
Next.js edge middleware cannot use Firebase Admin SDK (Node.js only). Options:
- Option A: Check for a Firebase auth cookie (set on login) — recommended
- Option B: Check for presence of `Authorization` header (less secure, header may not be set on page navigation)

**Files to create/modify**:
- `middleware.js` (create)
- `app/admin/login/page.js` (set auth cookie on successful login)
- `hooks/useAuth.js` (set/clear auth cookie on auth state change)

---

### Ticket 3: Update Firestore Security Rules
**Priority**: P0 — CRITICAL
**Effort**: Small (1 hour)
**Dependencies**: None

**Description**:
Add missing Firestore security rules for `cleanings` and `supply_requests` collections, and update `isStaff()` helper to properly scope access.

**Acceptance Criteria**:
- [ ] `cleanings` collection has security rules: staff can read/write, guests denied
- [ ] `supply_requests` collection has security rules: staff can read/write, guests denied
- [ ] New collections (`assignments`, `cleaning_jobs`, `staff_notifications`) have rules ready (can be empty initially, filled when collections are created)
- [ ] Rules deployed to Firebase

**Files to modify**:
- `firestore.rules`

---

### Ticket 4: Update Role Definitions and Co-Host Route Access
**Priority**: P1 — HIGH
**Effort**: Small (1-2 hours)
**Dependencies**: Ticket 1

**Description**:
Update `lib/roles.js` to restrict co-host access. Remove bookings, messages, and broadcast routes. Add new stays and assignments routes.

**Acceptance Criteria**:
- [ ] Co-host `allowedRoutes` updated to: `/admin`, `/admin/stays`, `/admin/assignments`, `/admin/maintenance`, `/admin/calendar`, `/admin/cleaning`
- [ ] Removed from co-host: `/admin/bookings`, `/admin/messages`, `/admin/notify`
- [ ] Nav items update correctly for co-host role
- [ ] Co-host accessing removed routes gets redirected

**Files to modify**:
- `lib/roles.js`
- `app/admin/layout.js` (update `allMoreLinks` to include new routes)

---

### Ticket 5: Build Filtered Stays API for Co-Host
**Priority**: P1 — HIGH
**Effort**: Small (2-3 hours)
**Dependencies**: Ticket 1, Ticket 4

**Description**:
Create a new API endpoint that returns sanitized, operations-relevant stay information for co-hosts, without exposing booking codes, guest links, phone numbers, or financial data.

**Acceptance Criteria**:
- [ ] `GET /api/stays/active` endpoint created
- [ ] Requires `admin` or `cohost` role
- [ ] Returns only: `{ id, unit, guestFirstName, checkInDate, checkOutDate, status }`
- [ ] Excludes: `code`, `guestLink`, full `guestName`, phone, email
- [ ] Filters to active and upcoming bookings only (not historical)
- [ ] Admin can also use this endpoint

**Files to create**:
- `app/api/stays/active/route.js`

---

### Ticket 6: Build Co-Host Stays Page
**Priority**: P1 — HIGH
**Effort**: Small (2-3 hours)
**Dependencies**: Ticket 5

**Description**:
Create the `/admin/stays` page showing filtered active stays for co-host view.

**Acceptance Criteria**:
- [ ] Page at `/admin/stays/page.js`
- [ ] Fetches from `GET /api/stays/active`
- [ ] Shows cards with unit, guest first name, dates, status badge
- [ ] No create/edit/delete buttons
- [ ] Mobile-responsive
- [ ] Admin can also access this page

**Files to create**:
- `app/admin/stays/page.js`

---

### Ticket 7: Build Admin Assignment/Todo API
**Priority**: P1 — HIGH
**Effort**: Medium (4-6 hours)
**Dependencies**: Ticket 1

**Description**:
Create CRUD API for the admin assignment/todo system. Admin creates tasks, assignees update status.

**Acceptance Criteria**:
- [ ] `GET /api/assignments` — list tasks (admin: all, others: own only)
- [ ] `POST /api/assignments` — create task (admin only)
- [ ] `PATCH /api/assignments/[id]` — update task (admin: any field, assignee: status + completionNote only)
- [ ] `DELETE /api/assignments/[id]` — delete task (admin only)
- [ ] Task creation sends notification to assignee
- [ ] Task completion sends notification to admin
- [ ] Validates: title required, assigneeId must be active staff, status transitions are valid, priority is valid enum
- [ ] Stores in `assignments` Firestore collection

**Files to create**:
- `app/api/assignments/route.js`
- `app/api/assignments/[id]/route.js`

**Files to modify**:
- `firestore.rules` (add `assignments` rules)

---

### Ticket 8: Build Admin Assignments Page
**Priority**: P1 — HIGH
**Effort**: Medium (6-8 hours)
**Dependencies**: Ticket 7

**Description**:
Create the `/admin/assignments` page with dual views for admin (full management) and co-host (own tasks only).

**Acceptance Criteria**:
- [ ] Page at `/admin/assignments/page.js`
- [ ] Admin view: board/list toggle, all tasks visible, create task button + modal
- [ ] Co-host view: own tasks only, status update buttons, no create
- [ ] Create task form: title, description, assignee dropdown, due date, priority, unit
- [ ] Task cards: title, priority badge, due date, assignee, status
- [ ] Status transitions via buttons: Start (→ in_progress), Done (→ completed with note modal)
- [ ] Admin can cancel and reopen tasks
- [ ] Overdue tasks highlighted
- [ ] Mobile-responsive
- [ ] Real-time updates via Firestore listener

**Files to create**:
- `app/admin/assignments/page.js`

---

### Ticket 9: Build Cleaning Job API
**Priority**: P2 — MEDIUM
**Effort**: Medium (6-8 hours)
**Dependencies**: Ticket 1

**Description**:
Create API endpoints for the structured cleaning workflow with state machine enforcement.

**Acceptance Criteria**:
- [ ] `GET /api/cleaning/jobs` — list jobs (admin/cohost: all, cleaner: own)
- [ ] `POST /api/cleaning/jobs` — create job (admin only)
- [ ] `PATCH /api/cleaning/jobs/[id]` — update status (cleaner: own jobs, valid transitions only)
- [ ] `POST /api/cleaning/jobs/[id]/photos` — upload photo references (cleaner: own jobs)
- [ ] `POST /api/cleaning/jobs/[id]/issues` — report issue (cleaner: own jobs)
- [ ] State machine enforced: `scheduled → acknowledged → en_route → arrived → before_photos → cleaning → after_photos → laundry_check → completed`
- [ ] Each transition sends appropriate notifications to admin + co-host
- [ ] Issue reports send immediate notification
- [ ] Validates assigneeId matches caller for cleaner role

**Files to create**:
- `app/api/cleaning/jobs/route.js`
- `app/api/cleaning/jobs/[id]/route.js`
- `app/api/cleaning/jobs/[id]/photos/route.js`
- `app/api/cleaning/jobs/[id]/issues/route.js`

**Files to modify**:
- `firestore.rules` (add `cleaning_jobs` rules)

---

### Ticket 10: Build Spanish i18n Foundation
**Priority**: P2 — MEDIUM
**Effort**: Small (2-3 hours)
**Dependencies**: None

**Description**:
Create a lightweight i18n system for the cleaner experience. No heavy library — just a translations file, context provider, and locale hook.

**Acceptance Criteria**:
- [ ] `lib/i18n.js` with all Spanish cleaner flow strings (see Section 6)
- [ ] `hooks/useLocale.js` hook providing `{ locale, t, setLocale }`
- [ ] Locale defaults to `es` for cleaner role, `en` for all others
- [ ] Locale persisted in `localStorage`
- [ ] Language toggle component for cleaner header (ES / EN)

**Files to create**:
- `lib/i18n.js`
- `hooks/useLocale.js`
- `components/ui/LocaleToggle.js`

---

### Ticket 11: Build Cleaner Wizard Experience
**Priority**: P2 — MEDIUM
**Effort**: Large (8-12 hours)
**Dependencies**: Ticket 9, Ticket 10

**Description**:
Rebuild the cleaner experience as a Spanish-first, mobile-first wizard flow. One step at a time, large buttons, minimal typing.

**Acceptance Criteria**:
- [ ] Cleaner role sees wizard UI instead of current admin cleaning page
- [ ] Home screen shows upcoming cleanings with "Confirmar" buttons
- [ ] Active job shows step-by-step wizard (9 steps, see Section 5)
- [ ] Each step is a full-screen card with ONE primary action
- [ ] All text in Spanish by default with EN toggle
- [ ] Touch targets minimum 48px (prefer 56px)
- [ ] Camera integration for photo capture (before/after/issue/laundry)
- [ ] Issue reporting with category buttons (Daño/Faltante/Reparación/Otro)
- [ ] Laundry check with Yes/No buttons
- [ ] Completion summary screen
- [ ] Status transitions call `PATCH /api/cleaning/jobs/[id]` at each step
- [ ] Photos upload to Firebase Storage, URLs stored via `POST /api/cleaning/jobs/[id]/photos`

**Files to create**:
- `components/cleaner/CleaningWizard.js`
- `components/cleaner/steps/Acknowledge.js`
- `components/cleaner/steps/EnRoute.js`
- `components/cleaner/steps/Arrived.js`
- `components/cleaner/steps/BeforePhotos.js`
- `components/cleaner/steps/Cleaning.js`
- `components/cleaner/steps/IssueReport.js`
- `components/cleaner/steps/AfterPhotos.js`
- `components/cleaner/steps/LaundryCheck.js`
- `components/cleaner/steps/Complete.js`

**Files to modify**:
- `app/admin/cleaning/page.js` (add role-based rendering: cleaner → wizard, admin/cohost → dashboard)
- `app/admin/layout.js` (update cleaner shell with Spanish header + locale toggle)

---

### Ticket 12: Build Staff Notification Infrastructure
**Priority**: P2 — MEDIUM
**Effort**: Medium (4-6 hours)
**Dependencies**: Ticket 1

**Description**:
Create the staff notification helper library and integrate FCM for staff members.

**Acceptance Criteria**:
- [ ] `lib/staff-notifications.js` with `notifyStaff()` and `notifyAdminAndCohost()` helpers
- [ ] Staff FCM token registration (update `usePush` to support staff tokens with UID-based keys)
- [ ] Staff notifications stored in `staff_notifications` collection
- [ ] Admin + co-host layouts import `usePush` for FCM registration
- [ ] Cleaner layout imports `usePush` for FCM registration
- [ ] Create `public/firebase-messaging-sw.js` for background push
- [ ] SMS fallback for staff without FCM tokens

**Files to create**:
- `lib/staff-notifications.js`
- `public/firebase-messaging-sw.js`

**Files to modify**:
- `hooks/usePush.js` (support staff token registration with `staffId` instead of `bookingCode`)
- `app/admin/layout.js` (import and call `usePush`)
- `firestore.rules` (add `staff_notifications` rules)

---

### Ticket 13: Update Admin Dashboard for Role-Aware Display
**Priority**: P2 — MEDIUM
**Effort**: Medium (3-4 hours)
**Dependencies**: Ticket 6, Ticket 8

**Description**:
Update the admin dashboard to show role-appropriate content. Co-host sees operational summary; admin sees full dashboard.

**Acceptance Criteria**:
- [ ] Admin dashboard shows all current stats (unchanged)
- [ ] Co-host dashboard shows: active stays summary, pending assignments count, open maintenance count, today's cleaning status
- [ ] Co-host dashboard has quick-action card: "View My Tasks"
- [ ] No financial data visible to co-host
- [ ] No booking creation affordance for co-host

**Files to modify**:
- `app/admin/page.js`

---

### Ticket 14: Add Property-Scoping Foundation
**Priority**: P3 — LOW (future-proofing)
**Effort**: Medium (4-6 hours)
**Dependencies**: Ticket 7, Ticket 9

**Description**:
Add `propertyId` field to key collections and `properties` array to user profiles. Default all to 'casa-coqui'. This creates the foundation for multi-property support without changing current behavior.

**Acceptance Criteria**:
- [ ] `propertyId: 'casa-coqui'` added to new docs in: `bookings`, `maintenance`, `cleaning_jobs`, `assignments`, `expenses`, `revenue`
- [ ] `properties: ['casa-coqui']` added to `users` docs
- [ ] Existing data migration script adds `propertyId` to existing docs
- [ ] API endpoints accept optional `propertyId` filter (defaults to all assigned properties)
- [ ] No behavior change for current single-property setup

**Files to modify**:
- All API route files that create documents
- `app/api/admin/invite/route.js` (set default properties)
- `scripts/migrate-add-propertyId.js` (create)

---

### Ticket 15: Integrate FCM Push for Guest Portal
**Priority**: P3 — LOW (cost optimization)
**Effort**: Small (2-3 hours)
**Dependencies**: Ticket 12

**Description**:
Import and activate the `usePush` hook in the guest portal to enable FCM push notifications, reducing Twilio SMS costs.

**Acceptance Criteria**:
- [ ] `usePush` imported in guest layout or guest home page
- [ ] Guest is prompted to allow notifications after check-in completion
- [ ] FCM token registered with guest's `bookingCode`
- [ ] Broadcasts use FCM push for guests with tokens, SMS fallback for others
- [ ] Background push notifications work via service worker

**Files to modify**:
- `app/g/[code]/layout.js` or `app/g/[code]/page.js`
- Verify `public/firebase-messaging-sw.js` handles guest notifications

---

### Implementation Priority Order

```
Phase 0 (Security — DO FIRST):
  Ticket 1:  Secure API routes          P0  ~2-3h
  Ticket 2:  Add Next.js middleware      P0  ~1-2h
  Ticket 3:  Update Firestore rules      P0  ~1h

Phase 1 (Co-Host Experience):
  Ticket 4:  Update role definitions     P1  ~1-2h
  Ticket 5:  Filtered stays API          P1  ~2-3h
  Ticket 6:  Co-host stays page          P1  ~2-3h
  Ticket 7:  Assignment/todo API         P1  ~4-6h
  Ticket 8:  Assignments page            P1  ~6-8h
  Ticket 13: Role-aware dashboard        P2  ~3-4h

Phase 2 (Cleaner Experience):
  Ticket 9:  Cleaning job API            P2  ~6-8h
  Ticket 10: Spanish i18n foundation     P2  ~2-3h
  Ticket 11: Cleaner wizard              P2  ~8-12h

Phase 3 (Notifications & Polish):
  Ticket 12: Staff notification infra    P2  ~4-6h
  Ticket 15: Guest FCM integration       P3  ~2-3h

Phase 4 (Future-Proofing):
  Ticket 14: Property-scoping foundation P3  ~4-6h
```

**Total estimated effort: ~50-70 hours**

---

## Assumptions & Open Questions

### Assumptions Made
1. **Single property** — Casa Coqui is one property with 2 units. Property-scoping is recommended for foundation but not required immediately.
2. **One admin** — The admin is a single person (the host). No multi-admin coordination needed.
3. **Co-host should NOT message guests** — Admin is the single point of guest communication. If the requirement changes, `POST /api/notifications/direct` can be re-enabled for co-host.
4. **Cleanings are admin-initiated** — Admin creates cleaning jobs manually (or they auto-generate from checkout dates). Cleaners do not self-assign.
5. **Maintenance role is out of scope for this plan** — The maintenance role gets similar treatment to current (single page access), but could be enhanced with a similar wizard pattern later.

### Open Questions
1. **Should co-host be able to message guests?** — This plan restricts it. If needed, restore `/admin/messages` access but scope to read-only or pre-approved responses.
2. **Should cleaning jobs auto-generate from bookings?** — This plan assumes manual creation. A Cloud Function that creates a `cleaning_job` doc when a booking's checkout date approaches would be a valuable enhancement.
3. **Should the checklist template system be Phase 1 or Phase 2?** — This plan defers templates to Phase 2. If admin needs templated checklists immediately, move it up.
4. **Should maintenance notifications be in scope?** — Currently, maintenance creation/updates send no notifications. This plan's Ticket 12 infrastructure supports it, but the trigger code isn't explicitly ticketed. Consider adding it to Ticket 12.
5. **How should the cleaner authenticate?** — Currently uses email/password. Consider: should the cleaner get a magic link instead? Or a PIN? Email/password may be friction for a non-technical Spanish-speaking cleaner. This plan assumes email/password is kept but the login page could get a Spanish translation.
