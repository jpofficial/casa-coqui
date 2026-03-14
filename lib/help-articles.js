// ─── Help Articles — Static content + contextual page mapping ────────────────
// Each page key maps to articles shown when the help drawer opens on that page.
// `screen` blocks reference ScreenMockup components rendered inline as screenshots.
// Format: { type: 'screen', component: 'ComponentName', props: { ... } }

const GUEST_ARTICLES = [
  {
    id: 'getting-started',
    title: 'Getting started with your guest portal',
    summary: 'Everything you need to know about accessing and using your stay portal.',
    category: 'onboarding',
    body: [
      { type: 'text', content: 'Your guest portal is a personalized hub for your stay at Casa Coqui. You received a unique link via email or text when your booking was confirmed.' },
      { type: 'heading', content: 'How to access your portal' },
      { type: 'step', number: 1, content: 'Tap the link you received from your host.' },
      { type: 'step', number: 2, content: 'Enter your phone number and verify with the code sent via SMS.' },
      { type: 'step', number: 3, content: 'Fill out the check-in form with your arrival details.' },
      { type: 'screen', component: 'CheckinScreen', props: { highlightField: 'submit' } },
      { type: 'step', number: 4, content: 'You\'re in! Browse the home screen to explore everything.' },
      { type: 'screen', component: 'HomeScreen', props: {} },
      { type: 'tip', content: 'Bookmark the link or add it to your home screen so you can return easily.' },
      { type: 'trouble', title: 'Didn\'t receive the SMS code?', content: 'Make sure you entered the correct phone number. Wait 30 seconds, then tap "Resend code." If it still doesn\'t arrive, check that your phone can receive SMS and try again.' },
    ],
  },
  {
    id: 'check-in',
    title: 'How to check in',
    summary: 'Complete your check-in before you arrive so everything is ready.',
    category: 'check-in',
    body: [
      { type: 'text', content: 'Check-in lets your host know you\'re coming and collects details needed for a smooth arrival.' },
      { type: 'step', number: 1, content: 'Tap "Check-In Guide" from the home screen.' },
      { type: 'screen', component: 'HomeScreen', props: { highlightCard: 'checkin-guide' } },
      { type: 'step', number: 2, content: 'Fill in your name, email, arrival time, and number of guests.' },
      { type: 'screen', component: 'CheckinScreen', props: { highlightField: 'name' } },
      { type: 'step', number: 3, content: 'Add any special requests (early check-in, accessibility needs, etc.).' },
      { type: 'step', number: 4, content: 'Tap "Complete Check-In" to submit.' },
      { type: 'screen', component: 'CheckinScreen', props: { highlightField: 'submit' } },
      { type: 'tip', content: 'Check in as early as possible so your host can prepare for your arrival.' },
    ],
  },
  {
    id: 'access-codes',
    title: 'WiFi password and access codes',
    summary: 'Find your WiFi password, gate code, and lockbox information.',
    category: 'property',
    body: [
      { type: 'text', content: 'All access codes for your stay are on the Info page.' },
      { type: 'step', number: 1, content: 'Tap "Info" in the bottom navigation bar.' },
      { type: 'screen', component: 'AccessScreen', props: {} },
      { type: 'step', number: 2, content: 'Find WiFi network name and password at the top.' },
      { type: 'screen', component: 'AccessScreen', props: { highlightSection: 'wifi' } },
      { type: 'step', number: 3, content: 'Scroll down for gate code, lockbox code, and parking spot info.' },
      { type: 'screen', component: 'AccessScreen', props: { highlightSection: 'lockbox' } },
      { type: 'tip', content: 'Tap "Copy" next to any code to copy it to your clipboard.' },
    ],
  },
  {
    id: 'house-rules',
    title: 'House rules and guidelines',
    summary: 'Quiet hours, guest policies, parking rules, and more.',
    category: 'property',
    body: [
      { type: 'text', content: 'House rules help everyone enjoy their stay. Please review them when you arrive.' },
      { type: 'step', number: 1, content: 'Tap "House Rules" from the Quick Access grid on the home screen.' },
      { type: 'screen', component: 'HomeScreen', props: { highlightCard: 'rules' } },
      { type: 'step', number: 2, content: 'Tap any section to expand it (Quiet Hours, No Smoking, etc.).' },
      { type: 'screen', component: 'RulesScreen', props: {} },
      { type: 'step', number: 3, content: 'Review quiet hours, guest limits, smoking, pets, and safety info.' },
    ],
  },
  {
    id: 'maintenance',
    title: 'Submit a maintenance request',
    summary: 'Report a broken appliance, leak, or anything that needs fixing.',
    category: 'maintenance',
    body: [
      { type: 'text', content: 'If something in the property isn\'t working, let your host know right away.' },
      { type: 'heading', content: 'How to submit a request' },
      { type: 'step', number: 1, content: 'Tap "Maintenance" from the Quick Access grid on the home screen.' },
      { type: 'screen', component: 'HomeScreen', props: { highlightCard: 'maintenance' } },
      { type: 'step', number: 2, content: 'Select a category (Plumbing, Electrical, HVAC, Appliance, or Other).' },
      { type: 'screen', component: 'MaintenanceScreen', props: { highlightField: 'category' } },
      { type: 'step', number: 3, content: 'Pick urgency: Low, Medium, or High.' },
      { type: 'screen', component: 'MaintenanceScreen', props: { highlightField: 'urgency' } },
      { type: 'step', number: 4, content: 'Describe the issue — be specific about what happened and where.' },
      { type: 'screen', component: 'MaintenanceScreen', props: { highlightField: 'description' } },
      { type: 'step', number: 5, content: 'Add a photo if possible (helps your host understand the problem).' },
      { type: 'screen', component: 'MaintenanceScreen', props: { highlightField: 'photo' } },
      { type: 'step', number: 6, content: 'Tap "Submit Request."' },
      { type: 'screen', component: 'MaintenanceSuccessScreen', props: {} },
      { type: 'tip', content: 'Mark urgency as "High" only for safety issues or things that make a room unusable.' },
      { type: 'trouble', title: 'Photo won\'t upload?', content: 'Try again on WiFi instead of cellular data. If the image is very large, take a new photo directly from your phone camera (it auto-compresses).' },
    ],
  },
  {
    id: 'parking',
    title: 'Parking info and reporting issues',
    summary: 'Find your parking spot and report parking problems.',
    category: 'parking',
    body: [
      { type: 'text', content: 'Your assigned parking spot and property parking info are on the Info page.' },
      { type: 'step', number: 1, content: 'Tap "Info" in the bottom navigation.' },
      { type: 'step', number: 2, content: 'Find the parking map showing your assigned spot.' },
      { type: 'screen', component: 'ParkingScreen', props: {} },
      { type: 'step', number: 3, content: 'To report a parking issue, tap the report button.' },
      { type: 'screen', component: 'ParkingScreen', props: { highlightReport: true } },
      { type: 'step', number: 4, content: 'Take a photo and describe the issue.' },
      { type: 'tip', content: 'When you report a parking issue, an alert goes to all guests and your host. Your personal details stay private.' },
    ],
  },
  {
    id: 'laundry',
    title: 'Check laundry machine status',
    summary: 'See if the washer or dryer is available, in use, or needs attention.',
    category: 'laundry',
    body: [
      { type: 'text', content: 'Laundry status is reported by guests on the honor system. Check before heading down!' },
      { type: 'step', number: 1, content: 'Tap "Laundry" from the Quick Access grid on the home screen.' },
      { type: 'screen', component: 'HomeScreen', props: { highlightCard: 'laundry' } },
      { type: 'step', number: 2, content: 'See the current status of each machine: Available, In Use, or Needs Attention.' },
      { type: 'screen', component: 'LaundryScreen', props: {} },
      { type: 'step', number: 3, content: 'After using a machine, tap the status button to update it so other guests know.' },
      { type: 'screen', component: 'LaundryScreen', props: { highlightMachine: 'washer' } },
      { type: 'tip', content: '"Needs Attention" means something may be wrong with the machine. Your host will be notified.' },
    ],
  },
  {
    id: 'community',
    title: 'What is the community board?',
    summary: 'See property updates, parking alerts, and announcements from your host.',
    category: 'community',
    body: [
      { type: 'text', content: 'The community board shows announcements and updates during your stay. You\'ll see parking alerts, maintenance notices, and host messages.' },
      { type: 'step', number: 1, content: 'Tap "Broadcast" from the Quick Access grid on the home screen.' },
      { type: 'screen', component: 'HomeScreen', props: { highlightCard: 'broadcast' } },
      { type: 'step', number: 2, content: 'Browse recent posts from your host and automated alerts.' },
      { type: 'screen', component: 'CommunityScreen', props: {} },
      { type: 'tip', content: 'Posts are only visible during your stay dates, so you\'ll only see what\'s relevant to you.' },
    ],
  },
  {
    id: 'invite-companions',
    title: 'Invite your travel companions',
    summary: 'Share portal access with friends and family staying with you.',
    category: 'onboarding',
    body: [
      { type: 'text', content: 'As the primary guest, you can invite up to 5 travel companions to access the guest portal.' },
      { type: 'step', number: 1, content: 'Tap "Invite Group" from the home screen.' },
      { type: 'screen', component: 'HomeScreen', props: { highlightCard: 'invite' } },
      { type: 'step', number: 2, content: 'Enter your companion\'s name and email address.' },
      { type: 'screen', component: 'InviteScreen', props: { highlightField: 'form' } },
      { type: 'step', number: 3, content: 'Tap "Send Invite" — they\'ll receive a link via email.' },
      { type: 'step', number: 4, content: 'Track invite status: Pending (not yet joined) or Joined.' },
      { type: 'screen', component: 'InviteScreen', props: { highlightField: 'status' } },
      { type: 'tip', content: 'Only the primary guest (you) can send invites. Companions can view the portal but can\'t invite others.' },
      { type: 'trouble', title: 'Group is full?', content: 'The maximum is 6 people total (you + 5 companions). Remove a pending invite to make room.' },
    ],
  },
  {
    id: 'portal-expired',
    title: 'Why can\'t I access the portal?',
    summary: 'Your portal link may have expired after checkout.',
    category: 'troubleshooting',
    body: [
      { type: 'text', content: 'Your guest portal is active only during your booking dates. After checkout, the link stops working.' },
      { type: 'heading', content: 'Common reasons' },
      { type: 'step', number: 1, content: 'Your checkout date has passed — the portal deactivates automatically.' },
      { type: 'step', number: 2, content: 'Your booking was cancelled by the host.' },
      { type: 'step', number: 3, content: 'You\'re using an old or incorrect link.' },
      { type: 'tip', content: 'If you think this is an error, contact your host directly through Airbnb or the contact info you were given.' },
    ],
  },
  {
    id: 'emergency',
    title: 'Emergency contacts',
    summary: 'Who to call for safety issues or urgent problems.',
    category: 'troubleshooting',
    body: [
      { type: 'text', content: 'For life-threatening emergencies, always call 911 first.' },
      { type: 'heading', content: 'For property emergencies' },
      { type: 'step', number: 1, content: 'Submit a High-urgency maintenance request in the app.' },
      { type: 'screen', component: 'MaintenanceScreen', props: { highlightField: 'urgency' } },
      { type: 'step', number: 2, content: 'Contact your host directly using the phone number or Airbnb messaging.' },
      { type: 'step', number: 3, content: 'For fire, medical, or police emergencies: call 911.' },
    ],
  },
];

// ─── Page-to-article mapping ─────────────────────────────────────────────────

const PAGE_ARTICLES = {
  'guest-home': ['getting-started', 'check-in', 'access-codes', 'invite-companions'],
  'guest-checkin': ['check-in', 'getting-started'],
  'guest-access': ['access-codes', 'house-rules', 'parking'],
  'guest-parking': ['parking', 'access-codes'],
  'guest-rules': ['house-rules', 'access-codes'],
  'guest-laundry': ['laundry', 'community'],
  'guest-community': ['community', 'laundry'],
  'guest-maintenance': ['maintenance', 'emergency'],
  'guest-invite': ['invite-companions', 'getting-started'],
};

// ─── Public API ──────────────────────────────────────────────────────────────

export function getHelpContext(pathname, code) {
  if (!pathname || !code) return 'guest-home';
  const base = `/g/${code}`;

  if (pathname === base || pathname === `${base}/`) return 'guest-home';
  if (pathname.startsWith(`${base}/checkin`)) return 'guest-checkin';
  if (pathname.startsWith(`${base}/access`)) return 'guest-access';
  if (pathname.startsWith(`${base}/parking`)) return 'guest-parking';
  if (pathname.startsWith(`${base}/rules`)) return 'guest-rules';
  if (pathname.startsWith(`${base}/laundry`)) return 'guest-laundry';
  if (pathname.startsWith(`${base}/community`)) return 'guest-community';
  if (pathname.startsWith(`${base}/maintenance`)) return 'guest-maintenance';
  if (pathname.startsWith(`${base}/invite`)) return 'guest-invite';

  return 'guest-home';
}

export function getArticlesForPage(pageKey) {
  const ids = PAGE_ARTICLES[pageKey] || PAGE_ARTICLES['guest-home'];
  return ids.map(id => GUEST_ARTICLES.find(a => a.id === id)).filter(Boolean);
}

export function getAllArticles() {
  return GUEST_ARTICLES;
}

export function searchArticles(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  return GUEST_ARTICLES.filter(a =>
    a.title.toLowerCase().includes(q) ||
    a.summary.toLowerCase().includes(q) ||
    a.category.toLowerCase().includes(q)
  );
}
