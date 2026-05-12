'use client';

const EMOJI_BY_TYPE = {
  Restaurant: '🍴',
  'Street food': '🥟',
  Café: '☕',
  'Spanish colonial fort': '🏰',
  Museum: '🖼',
  'Craft cocktail bar': '🍸',
  Hike: '🥾',
  'Photo destination': '📸',
  default: '📍',
};

const TIME_LABEL = {
  early_morning: '7:00 AM',
  dawn: '6:00 AM',
  breakfast: '8:30 AM',
  morning: '10:00 AM',
  brunch: '11:00 AM',
  noon: '12:00 PM',
  lunch: '12:30 PM',
  afternoon: '2:00 PM',
  sunset: '6:30 PM',
  dusk: '7:00 PM',
  evening: '7:00 PM',
  dinner: '7:30 PM',
  night: '10:00 PM',
  late_night: '10:00 PM',
  midnight: '12:00 AM',
};

const AGGREGATOR_PATTERNS = [
  'instagram.com',
  'eater.com',
  'tripadvisor.com',
  'yelp.com',
  'airbnb.com/experiences',
  'viator.com',
];

function pickWebsiteUrl(sourceUrls) {
  if (!Array.isArray(sourceUrls)) return null;
  return (
    sourceUrls.find(
      (url) => !AGGREGATOR_PATTERNS.some((pat) => url.includes(pat))
    ) || null
  );
}

function pickInstagramUrl(sourceUrls) {
  if (!Array.isArray(sourceUrls)) return null;
  return sourceUrls.find((url) => url.includes('instagram.com')) || null;
}

function buildMapUrl(name, neighborhood) {
  const query = [name, neighborhood, 'San Juan Puerto Rico']
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Inline SVG icons — 14px square, stroke-based for crispness on Retina
function IconGlobe() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export default function ActivityCard({ item }) {
  if (!item?.activity) return null;
  const { activity, time, duration_min, note } = item;
  const emoji = EMOJI_BY_TYPE[activity.type] || EMOJI_BY_TYPE.default;

  const websiteUrl = pickWebsiteUrl(activity.source_urls);
  const instagramUrl = pickInstagramUrl(activity.source_urls);
  const mapUrl = buildMapUrl(activity.name, activity.neighborhood);
  const activityId = item.activity_id;

  const hasFooter = true; // Map is always rendered

  const linkClass =
    'inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-cafe-600 hover:text-coqui-900 transition-colors duration-150';

  return (
    <div className="mb-3 flex gap-3 rounded-2xl border border-cafe-100 bg-white p-4 shadow-[0_4px_14px_-2px_rgba(7,54,32,0.06)]">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-cafe-200 text-2xl">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="mb-0.5 font-mono text-[11px] text-caribe-600">
          {TIME_LABEL[time] || time} · ~{Math.round(duration_min / 30) * 30} min
        </div>
        <div className="mb-1 text-[15px] font-semibold leading-snug text-coqui-900">
          {activity.name}
        </div>
        <p className="text-xs leading-relaxed text-cafe-800">
          {note || activity.why_it_matters}
        </p>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-cafe-500">
          <span>{(activity.best_for_persona || []).slice(0, 2).join(' · ')}</span>
          <span>{activity.price_tier}</span>
        </div>

        {hasFooter && (
          <div className="mt-3 pt-3 border-t border-cafe-100 flex flex-wrap gap-4">
            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                data-event-name="activity_link_website"
                data-activity-id={activityId}
              >
                <IconGlobe />
                Website
              </a>
            )}

            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              data-event-name="activity_link_map"
              data-activity-id={activityId}
            >
              <IconMap />
              Map
            </a>

            {instagramUrl && (
              <a
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                data-event-name="activity_link_instagram"
                data-activity-id={activityId}
              >
                <IconInstagram />
                Instagram
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
