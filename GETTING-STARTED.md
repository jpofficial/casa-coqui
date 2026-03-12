# Casa Coqui — Getting Started with Claude Code

## Step 1: Set Up Your Project

Open your terminal and run:

```bash
# Create the Next.js project
npx create-next-app@latest casa-coqui --app --js --tailwind --eslint --src-dir=false --import-alias="@/*"
cd casa-coqui

# Install dependencies
npm install firebase firebase-admin twilio nanoid next-pwa recharts

# Create the folder structure
mkdir -p app/g/\[code\]/checkin
mkdir -p app/admin/{bookings,notify,expenses,supplies,maintenance,messages,receipts,revenue,calendar,login}
mkdir -p app/api/{bookings,guests/verify,guests/confirm,guests/\[id\]/checkin,notifications/broadcast,notifications/direct,expenses/report,supplies/reorder,maintenance/\[id\],laundry,receipts/inbound,receipts/\[month\],revenue}
mkdir -p components/{guest,admin,ui}
mkdir -p lib hooks public/icons functions
```

## Step 2: Drop In the Claude Code Files

Copy these files into your project:

```
CLAUDE.md              →  casa-coqui/CLAUDE.md
agents/                →  casa-coqui/.claude/agents/
  firebase-auth.md
  guest-portal.md
  community-messaging.md
  admin-dashboard.md
  expenses-supplies.md
  backend-functions.md
```

## Step 3: Set Up Firebase

1. Go to https://console.firebase.google.com
2. Create a new project called "casa-coqui"
3. Enable these services:
   - Firestore Database (start in test mode, lock down later)
   - Authentication → enable Phone and Email/Password providers
   - Cloud Storage
   - Cloud Messaging
4. Go to Project Settings → General → add a Web app
5. Copy the config and create `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

6. Generate a service account key (Project Settings → Service Accounts → Generate New Private Key)
7. Add to `.env.local`:

```
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

## Step 4: Set Up Twilio

1. Sign up at https://www.twilio.com (free trial gives you $15 credit)
2. Get a phone number that can send SMS
3. Add to `.env.local`:

```
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1234567890
```

## Step 5: Open Claude Code and Start Building

```bash
cd casa-coqui
claude
```

### Your First Prompt — Phase 1 Kickoff:

Paste this into Claude Code:

---

Read CLAUDE.md to understand the full project. Then execute Phase 1 (Foundation) using subagents:

**Use the firebase-auth agent to:**
1. Create lib/firebase.js with client-side Firebase initialization (Firestore, Auth, Storage)
2. Create lib/firebase-admin.js with server-side Admin SDK initialization
3. Create lib/twilio.js with SMS send and OTP helper functions
4. Create hooks/useAuth.js that handles both guest phone auth and admin email auth
5. Create app/api/guests/verify/route.js and app/api/guests/confirm/route.js for phone OTP
6. Create app/admin/login/page.js with email/password login form
7. Create firestore.rules with proper security rules

**Use the guest-portal agent to:**
1. Create app/g/[code]/layout.js with guest layout and bottom navigation
2. Create app/g/[code]/checkin/page.js with the pre-arrival check-in form (name, email, phone, arrival time, guest count) including the phone verification step
3. Create app/g/[code]/page.js as the guest home screen with quick-access cards
4. Create components/guest/CheckInGuide.js with step-by-step instructions
5. Create components/guest/Parking.js with visual parking map
6. Create components/guest/Rules.js pulling from Firestore settings
7. Create components/guest/AccessCodes.js with WiFi and lockbox codes

**Use the admin-dashboard agent to:**
1. Create app/admin/layout.js with admin layout and bottom nav
2. Create app/admin/page.js with dashboard home (stats cards + guest list)
3. Create app/admin/bookings/page.js with booking creation form that auto-generates unique guest links using nanoid
4. Create app/api/bookings/route.js for booking CRUD

After all agents complete, verify the app compiles with `npm run dev` and fix any integration issues.

---

### Phase 2 Prompt (after Phase 1 is working):

---

Phase 1 is complete. Now execute Phase 2 (Real-Time Features):

**Use the guest-portal agent to:**
1. Create components/guest/Laundry.js with real-time Firestore listeners for washer/dryer status and self-report toggle buttons

**Use the community-messaging agent to:**
1. Create components/guest/Community.js for the community board with real-time Firestore subscription
2. Create components/guest/ParkingReport.js with photo upload + auto-broadcast
3. Create components/guest/MaintenanceForm.js with category, description, and photo upload
4. Create components/guest/Chat.js for direct messaging with host
5. Create hooks/usePush.js for FCM push registration

**Use the admin-dashboard agent to:**
1. Add laundry toggle controls to the admin dashboard
2. Create app/admin/notify/page.js with quick-send templates and custom broadcast
3. Create app/admin/maintenance/page.js showing all requests with status management

**Use the backend-functions agent to:**
1. Create lib/notifications.js with unified push + SMS delivery
2. Create app/api/notifications/broadcast/route.js
3. Create app/api/notifications/direct/route.js
4. Create app/api/maintenance/route.js and app/api/maintenance/[id]/route.js
5. Create app/api/laundry/route.js for status get/toggle

Verify everything works together — test the laundry toggle, send a test broadcast, and confirm real-time updates work.

---

### Phase 3 and 4 follow the same pattern — reference the spec doc for details.

## Tips for Working with Claude Code Agents

1. **Be explicit about delegation** — Claude Code uses subagents more aggressively when you tell it exactly which agent to use for which task.

2. **Run `npm run dev` between phases** — Catch integration issues early.

3. **One phase at a time** — Don't try to build everything in one prompt. Each phase should result in a working app.

4. **If an agent gets stuck** — Try breaking its task into smaller pieces. Instead of "build the entire expense tracker", say "create the expense list page first, then we'll add the creation form."

5. **Use Ctrl+B to background agents** — While one agent is building components, you can review what another one created.

6. **Keep CLAUDE.md updated** — As you make decisions or changes during development, update CLAUDE.md so all agents stay in sync.
