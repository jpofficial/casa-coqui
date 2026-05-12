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

export default function ActivityCard({ item }) {
  if (!item?.activity) return null;
  const { activity, time, duration_min, note } = item;
  const emoji = EMOJI_BY_TYPE[activity.type] || EMOJI_BY_TYPE.default;

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
      </div>
    </div>
  );
}
