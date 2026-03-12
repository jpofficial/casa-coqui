'use client';

// ─── SVG parking map (fallback when no map image uploaded) ───────────────────
function ParkingMap({ unit }) {
  const unitA = unit === 'A';
  const unitB = unit === 'B';

  const highlightFill = '#dcfce7';
  const highlightStroke = '#16a34a';
  const neutralFill = '#f9fafb';
  const neutralStroke = '#d1d5db';
  const roadFill = '#e5e7eb';

  return (
    <svg
      viewBox="0 0 320 220"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full rounded-xl"
      role="img"
      aria-label={`Parking map. ${unit ? `Your spot is Unit ${unit}.` : 'Both units shown.'}`}
    >
      <rect width="320" height="220" fill="#f0fdf4" rx="12" />
      <rect x="0" y="175" width="320" height="45" fill={roadFill} rx="0" />
      <text x="160" y="202" textAnchor="middle" fontSize="11" fill="#9ca3af" fontFamily="system-ui, sans-serif">Coqui Lane</text>
      <line x1="0" y1="197" x2="320" y2="197" stroke="#d1d5db" strokeWidth="1" strokeDasharray="12 8" />
      <rect x="110" y="130" width="100" height="48" fill="#e9f5e9" />
      <line x1="160" y1="130" x2="160" y2="178" stroke="#bbf7d0" strokeWidth="2" strokeDasharray="6 4" />
      <rect x="105" y="170" width="110" height="6" rx="2" fill="#16a34a" />
      <rect x="105" y="170" width="50" height="6" rx="2" fill="#15803d" />
      <rect x="163" y="170" width="52" height="6" rx="2" fill="#15803d" />
      <text x="160" y="167" textAnchor="middle" fontSize="9" fill="#15803d" fontFamily="system-ui, sans-serif" fontWeight="600">GATE</text>
      <rect x="60" y="20" width="200" height="100" rx="6" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
      <text x="160" y="14" textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="system-ui, sans-serif">Main Building</text>
      <rect x="62" y="22" width="95" height="96" rx="4" fill={unitA ? highlightFill : neutralFill} stroke={unitA ? highlightStroke : neutralStroke} strokeWidth={unitA ? 2 : 1} />
      <text x="109" y="68" textAnchor="middle" fontSize="14" fill={unitA ? '#15803d' : '#6b7280'} fontFamily="system-ui, sans-serif" fontWeight="700">A</text>
      <text x="109" y="84" textAnchor="middle" fontSize="9" fill={unitA ? '#16a34a' : '#9ca3af'} fontFamily="system-ui, sans-serif">Unit A</text>
      {unitA && <text x="109" y="100" textAnchor="middle" fontSize="8" fill="#16a34a" fontFamily="system-ui, sans-serif" fontWeight="600">Your unit</text>}
      <rect x="163" y="22" width="95" height="96" rx="4" fill={unitB ? highlightFill : neutralFill} stroke={unitB ? highlightStroke : neutralStroke} strokeWidth={unitB ? 2 : 1} />
      <text x="210" y="68" textAnchor="middle" fontSize="14" fill={unitB ? '#15803d' : '#6b7280'} fontFamily="system-ui, sans-serif" fontWeight="700">B</text>
      <text x="210" y="84" textAnchor="middle" fontSize="9" fill={unitB ? '#16a34a' : '#9ca3af'} fontFamily="system-ui, sans-serif">Unit B</text>
      {unitB && <text x="210" y="100" textAnchor="middle" fontSize="8" fill="#16a34a" fontFamily="system-ui, sans-serif" fontWeight="600">Your unit</text>}
      <rect x="62" y="130" width="88" height="36" rx="3" fill={unitA ? highlightFill : neutralFill} stroke={unitA ? highlightStroke : neutralStroke} strokeWidth={unitA ? 2 : 1} strokeDasharray={unitA ? '0' : '4 3'} />
      <text x="106" y="149" textAnchor="middle" fontSize="10" fill={unitA ? '#15803d' : '#9ca3af'} fontFamily="system-ui, sans-serif" fontWeight={unitA ? '700' : '400'}>{unitA ? 'Your Spot' : 'Spot A'}</text>
      <rect x="170" y="130" width="88" height="36" rx="3" fill={unitB ? highlightFill : neutralFill} stroke={unitB ? highlightStroke : neutralStroke} strokeWidth={unitB ? 2 : 1} strokeDasharray={unitB ? '0' : '4 3'} />
      <text x="214" y="149" textAnchor="middle" fontSize="10" fill={unitB ? '#15803d' : '#9ca3af'} fontFamily="system-ui, sans-serif" fontWeight={unitB ? '700' : '400'}>{unitB ? 'Your Spot' : 'Spot B'}</text>
      <g transform="translate(290, 30)">
        <circle cx="0" cy="0" r="12" fill="white" stroke="#e5e7eb" strokeWidth="1" />
        <text x="0" y="4" textAnchor="middle" fontSize="10" fill="#6b7280" fontFamily="system-ui, sans-serif" fontWeight="700">N</text>
      </g>
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Parking({ bookingData, settings }) {
  const rawUnit = bookingData?.unit ?? null;
  // Normalize: "Unit A" → "A", "B" → "B"
  const unit = rawUnit ? rawUnit.replace(/^Unit\s*/i, '') : null;
  const parkingInfo = settings?.parkingInfo;

  // Per-apartment data (new schema)
  const aptKey = unit ? `apartment${unit}` : null;
  const apartment = aptKey ? parkingInfo?.[aptKey] : null;

  // Detect old schema (has `spots` or `rules` keys but no apartmentA)
  const isOldSchema = parkingInfo && !parkingInfo.apartmentA && (parkingInfo.spots || parkingInfo.rules !== undefined);

  // General notes
  const generalLines = (parkingInfo?.generalNotes || '')
    .split('\n')
    .filter((l) => l.trim());

  // Old schema fallback
  if (isOldSchema) {
    const ruleLines = parkingInfo?.rules
      ? parkingInfo.rules.split('\n').filter((l) => l.trim())
      : [];

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Parking</h2>
          {unit ? (
            <p className="text-sm text-gray-500 mt-0.5">
              Your designated spot is <span className="font-semibold text-green-700">Spot {unit}</span>.
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-0.5">Parking information for the property.</p>
          )}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3">
          {parkingInfo?.mapImageUrl ? (
            <img src={parkingInfo.mapImageUrl} alt="Parking map" className="w-full rounded-xl object-cover" />
          ) : (
            <ParkingMap unit={unit} />
          )}
        </div>
        {ruleLines.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Parking Rules</h3>
            <div className="flex flex-col gap-2">
              {ruleLines.map((rule, i) => (
                <div key={i} className="flex gap-3 items-start bg-white rounded-xl shadow-sm border border-gray-50 p-3">
                  <span className="flex-shrink-0 text-gray-400 mt-0.5 font-bold text-sm">{i + 1}.</span>
                  <p className="text-sm text-gray-600 leading-snug">{rule}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Heading */}
      <div>
        <h2 className="text-base font-bold text-gray-900">
          Parking{unit ? ` — Unit ${unit}` : ''}
        </h2>
        {apartment?.instructions ? (
          <p className="text-sm text-gray-500 mt-0.5">{apartment.instructions}</p>
        ) : unit ? (
          <p className="text-sm text-gray-500 mt-0.5">
            Your designated spot is <span className="font-semibold text-green-700">Spot {unit}</span>.
          </p>
        ) : (
          <p className="text-sm text-gray-500 mt-0.5">Parking information for the property.</p>
        )}
      </div>

      {/* Map */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3">
        {apartment?.mapImageUrl ? (
          <img src={apartment.mapImageUrl} alt={`Parking map for Unit ${unit}`} className="w-full rounded-xl object-cover" />
        ) : (
          <>
            <ParkingMap unit={unit} />
            <div className="flex gap-4 mt-2 px-1 justify-center">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-green-100 border-2 border-green-600" />
                <span className="text-xs text-gray-500">Your unit &amp; spot</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-gray-50 border border-dashed border-gray-300" />
                <span className="text-xs text-gray-500">Other unit</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Steps */}
      {apartment?.steps?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Parking Steps</h3>
          <div className="flex flex-col gap-2">
            {apartment.steps.map((step, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-50 p-3">
                <div className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-sm text-gray-700 leading-snug">{step.description}</p>
                </div>
                {step.imageUrl && (
                  <img
                    src={step.imageUrl}
                    alt={`Step ${i + 1}`}
                    className="w-full h-32 object-cover rounded-lg mt-2"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* General notes */}
      {generalLines.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1.5">General Notes</p>
          <ul className="flex flex-col gap-1">
            {generalLines.map((note, i) => (
              <li key={i} className="text-sm text-amber-800 leading-snug flex gap-2">
                <span className="text-amber-400 flex-shrink-0">&bull;</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
