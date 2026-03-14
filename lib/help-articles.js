// ─── Help Articles — Static content + contextual page mapping ────────────────
// Each page key maps to articles shown when the help drawer opens on that page.
// Keep articles concise: title, summary, steps, and troubleshooting.

const GUEST_ARTICLES = [
  {
    id: 'getting-started',
    title: 'Getting started with your guest portal',
    summary: 'Everything you need to know about accessing and using your stay portal.',
    category: 'onboarding',
    body: [
      { type: 'text', content: 'Your guest portal is a personalized hub for your stay at Casa Coqui. You received a unique link via email or text when your booking was confirmed.' },
      { type: 'heading', content: 'How to access your portal' },
      { type: 'steps', content: [
        'Tap the link you received from your host.',
        'Enter your phone number and verify with the code sent via SMS.',
        'Fill out the check-in form with your arrival details.',
        'You\'re in! Browse the home screen to explore everything.',
      ]},
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
      { type: 'steps', content: [
        'Tap "Check-In Guide" from the home screen.',
        'Review and fill out your guest details (name, phone, email).',
        'Confirm your arrival date and approximate time.',
        'Submit the form — you\'ll see a confirmation.',
      ]},
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
      { type: 'steps', content: [
        'Tap "Info" in the bottom navigation bar.',
        'Find WiFi network name and password at the top.',
        'Scroll down for gate code, lockbox code, and parking spot info.',
      ]},
      { type: 'tip', content: 'Tap any code to copy it to your clipboard.' },
    ],
  },
  {
    id: 'house-rules',
    title: 'House rules and guidelines',
    summary: 'Quiet hours, guest policies, parking rules, and more.',
    category: 'property',
    body: [
      { type: 'text', content: 'House rules help everyone enjoy their stay. Please review them when you arrive.' },
      { type: 'steps', content: [
        'Tap "More" in the bottom navigation.',
        'Select "House Rules" from the menu.',
        'Review quiet hours, guest limits, smoking, pets, and safety info.',
      ]},
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
      { type: 'steps', content: [
        'Tap "More" then "Maintenance" from the bottom nav.',
        'Select a category (Plumbing, Electrical, HVAC, Appliance, or Other).',
        'Pick urgency: Low, Medium, or High.',
        'Describe the issue — be specific about what happened and where.',
        'Add a photo if possible (helps your host understand the problem).',
        'Tap "Submit Request."',
      ]},
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
      { type: 'steps', content: [
        'Tap "Info" in the bottom navigation.',
        'Scroll to the Parking section to see your assigned spot.',
        'To report a parking issue, tap the report button.',
        'Take a photo and describe the issue.',
      ]},
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
      { type: 'steps', content: [
        'Tap "More" then "Laundry" from the bottom nav.',
        'See the current status of each machine: Available, In Use, or Needs Attention.',
        'After using a machine, update the status so other guests know.',
      ]},
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
      { type: 'steps', content: [
        'Tap "More" then "Broadcast" from the bottom nav.',
        'Browse recent posts from your host and automated alerts.',
      ]},
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
      { type: 'steps', content: [
        'Tap "Invite Group" from the home screen.',
        'Enter your companion\'s name and email address.',
        'Tap "Send Invite" — they\'ll receive a link via email.',
        'Track invite status: Pending (not yet joined) or Joined.',
      ]},
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
      { type: 'steps', content: [
        'Your checkout date has passed — the portal deactivates automatically.',
        'Your booking was cancelled by the host.',
        'You\'re using an old or incorrect link.',
      ]},
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
      { type: 'steps', content: [
        'Submit a High-urgency maintenance request in the app.',
        'Contact your host directly using the phone number or Airbnb messaging.',
        'For fire, medical, or police emergencies: call 911.',
      ]},
    ],
  },
];

// ─── Page-to-article mapping ─────────────────────────────────────────────────
// Keys match pathname patterns. The help drawer shows these articles
// when opened on the corresponding page.

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
