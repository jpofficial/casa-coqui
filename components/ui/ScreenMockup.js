'use client';

// ─── ScreenMockup — Inline phone-frame screenshots for help articles ────────
// These are miniature React renders of actual app screens, using the same
// Tailwind classes. They never go stale because they share the design system.

// ─── Phone frame wrapper ────────────────────────────────────────────────────
function PhoneFrame({ children, caption }) {
  return (
    <div className="my-3">
      <div className="mx-auto w-[220px] bg-gray-900 rounded-[20px] p-1.5 shadow-lg">
        {/* Notch */}
        <div className="relative bg-white rounded-[16px] overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-3 bg-gray-900 rounded-b-lg z-10" />
          {/* Screen content */}
          <div className="pt-5 pb-2 min-h-[180px]">
            {children}
          </div>
        </div>
      </div>
      {caption && (
        <p className="text-[10px] text-gray-400 text-center mt-1.5 italic">{caption}</p>
      )}
    </div>
  );
}

// ─── Highlight ring for callout ─────────────────────────────────────────────
function Highlight({ children, active }) {
  if (!active) return children;
  return (
    <div className="relative">
      <div className="absolute -inset-0.5 rounded-lg ring-2 ring-green-500 ring-offset-1 pointer-events-none z-10" />
      <div className="absolute -top-2.5 -right-1 bg-green-500 text-white text-[7px] font-bold px-1 py-0.5 rounded z-20 leading-none">
        TAP
      </div>
      {children}
    </div>
  );
}

// ─── Mini header (shared across screens) ────────────────────────────────────
function MiniHeader({ helpHighlight }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1.5 border-b border-gray-100">
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 text-green-600">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-1.72-1.72V5.25a.75.75 0 00-.75-.75h-1.5a.75.75 0 00-.75.75v1.79l-4.72-4.72a.75.75 0 00-1.06 0l-8.69 8.69a.75.75 0 001.06 1.06l8.16-8.16z" /><path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198c.031-.028.061-.056.091-.086L12 5.432z" /></svg>
        </div>
        <span className="text-[8px] font-semibold text-gray-900">Casa Coqui</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[6px] text-gray-400 font-mono bg-gray-50 px-1 py-0.5 rounded">#abc</span>
        <Highlight active={helpHighlight}>
          <div className="w-3.5 h-3.5 text-green-600">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.06-1.06 3.5 3.5 0 014.753.45A3.5 3.5 0 0113.5 9.5a2.25 2.25 0 01-2.25 2.25.75.75 0 01-.75-.75v-1a.75.75 0 01.75-.75A.75.75 0 0012 8.5a2 2 0 00-3.06-1.56zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
          </div>
        </Highlight>
      </div>
    </div>
  );
}

// ─── Mini bottom nav ────────────────────────────────────────────────────────
function MiniBottomNav({ active }) {
  const tabs = [
    { label: 'Home', isActive: active === 'home' },
    { label: 'Info', isActive: active === 'info' },
    { label: 'Guide', isActive: active === 'guide' },
  ];
  return (
    <div className="flex items-center justify-around border-t border-gray-100 pt-1 px-1">
      {tabs.map(t => (
        <div key={t.label} className={`flex flex-col items-center gap-0.5 ${t.isActive ? 'text-green-600' : 'text-gray-400'}`}>
          <div className="w-3 h-3 bg-current rounded-sm opacity-60" />
          <span className="text-[6px] font-medium">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Mini card (for home grid) ──────────────────────────────────────────────
function MiniCard({ title, color, highlight }) {
  return (
    <Highlight active={highlight}>
      <div className="bg-white rounded-md border border-gray-50 p-1.5 shadow-sm">
        <div className={`w-4 h-4 rounded ${color} mb-0.5`} />
        <div className="text-[6px] font-semibold text-gray-900 leading-tight">{title}</div>
      </div>
    </Highlight>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN MOCKUPS — One per help article step
// ═══════════════════════════════════════════════════════════════════════════

// ─── Home screen with card grid ─────────────────────────────────────────────
export function HomeScreen({ highlightCard }) {
  const cards = [
    { title: 'Check-In Guide', color: 'bg-green-100', id: 'checkin-guide' },
    { title: 'Parking', color: 'bg-amber-100', id: 'parking' },
    { title: 'House Rules', color: 'bg-blue-100', id: 'rules' },
    { title: 'Access Codes', color: 'bg-purple-100', id: 'access' },
    { title: 'Laundry', color: 'bg-teal-100', id: 'laundry' },
    { title: 'Broadcast', color: 'bg-rose-100', id: 'broadcast' },
    { title: 'Maintenance', color: 'bg-red-100', id: 'maintenance' },
    { title: 'Invite Group', color: 'bg-cyan-100', id: 'invite' },
  ];
  return (
    <PhoneFrame caption={highlightCard ? `Tap "${cards.find(c => c.id === highlightCard)?.title}"` : 'Guest home screen'}>
      <MiniHeader />
      <div className="px-2.5 pt-2">
        <div className="text-[8px] font-bold text-gray-900 mb-0.5">Welcome, Guest</div>
        <div className="text-[6px] text-gray-400 mb-2">Your home for this trip</div>
        <div className="text-[5px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Quick Access</div>
        <div className="grid grid-cols-2 gap-1">
          {cards.map(c => (
            <MiniCard key={c.id} title={c.title} color={c.color} highlight={highlightCard === c.id} />
          ))}
        </div>
      </div>
      <MiniBottomNav active="home" />
    </PhoneFrame>
  );
}

// ─── Check-in form ──────────────────────────────────────────────────────────
export function CheckinScreen({ highlightField }) {
  const fields = [
    { label: 'Full name', placeholder: 'Jane Smith', id: 'name' },
    { label: 'Email address', placeholder: 'jane@example.com', id: 'email' },
    { label: 'Arrival time', placeholder: 'Select a time...', id: 'time' },
    { label: 'Number of guests', placeholder: '1', id: 'guests' },
  ];
  return (
    <PhoneFrame caption="Check-in form">
      <div className="px-3 pt-2">
        <div className="bg-white rounded-lg border border-gray-50 p-2.5 shadow-sm">
          <div className="text-[8px] font-bold text-gray-900 text-center mb-0.5">Welcome to Casa Coqui</div>
          <div className="text-[6px] text-gray-400 text-center mb-2">Fill in a few quick details</div>
          <div className="space-y-1.5">
            {fields.map(f => (
              <Highlight key={f.id} active={highlightField === f.id}>
                <div>
                  <div className="text-[6px] font-medium text-gray-600 mb-0.5">{f.label}</div>
                  <div className="bg-gray-50 rounded px-1.5 py-1 text-[6px] text-gray-400 border border-gray-200">{f.placeholder}</div>
                </div>
              </Highlight>
            ))}
          </div>
          <Highlight active={highlightField === 'submit'}>
            <div className="bg-green-600 text-white text-[7px] font-semibold text-center py-1.5 rounded-md mt-2">Complete Check-In</div>
          </Highlight>
        </div>
      </div>
    </PhoneFrame>
  );
}

// ─── Access codes page ──────────────────────────────────────────────────────
export function AccessScreen({ highlightSection }) {
  const sections = [
    { title: 'WiFi', icon: '📶', label: 'NETWORK NAME', value: 'CasaCoqui-5G', id: 'wifi', color: 'bg-purple-50' },
    { title: 'Gate Code', icon: '🚪', label: '4-DIGIT CODE', value: '••••', id: 'gate', color: 'bg-green-50' },
    { title: 'Lockbox', icon: '🔐', label: '4-DIGIT CODE', value: '••••', id: 'lockbox', color: 'bg-amber-50' },
  ];
  return (
    <PhoneFrame caption="Access codes & WiFi">
      <MiniHeader />
      <div className="px-2.5 pt-2 space-y-1.5">
        <div className="text-[8px] font-bold text-gray-900">Access Codes</div>
        {sections.map(s => (
          <Highlight key={s.id} active={highlightSection === s.id}>
            <div className="bg-white rounded-md border border-gray-50 p-2 shadow-sm">
              <div className="flex items-center gap-1 mb-1">
                <div className={`w-4 h-4 rounded flex items-center justify-center text-[8px] ${s.color}`}>{s.icon}</div>
                <span className="text-[7px] font-semibold text-gray-900">{s.title}</span>
              </div>
              <div className="text-[5px] text-gray-400 uppercase tracking-wider">{s.label}</div>
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-mono font-bold text-gray-900">{s.value}</span>
                <span className="text-[5px] bg-gray-100 px-1 py-0.5 rounded text-gray-500">Copy</span>
              </div>
            </div>
          </Highlight>
        ))}
      </div>
      <MiniBottomNav active="info" />
    </PhoneFrame>
  );
}

// ─── Bottom nav showing Guide tab ───────────────────────────────────────────
export function BottomNavScreen({ highlightItem }) {
  return (
    <PhoneFrame caption={highlightItem ? `Tap "${highlightItem}"` : 'Bottom navigation'}>
      <MiniHeader />
      <div className="px-2.5 pt-2">
        <div className="text-[8px] font-bold text-gray-900 mb-1">Welcome, Guest</div>
        <div className="h-24 flex items-center justify-center text-[7px] text-gray-300">
          (page content)
        </div>
      </div>
      <MiniBottomNav active={highlightItem === 'Guide' ? 'guide' : highlightItem === 'Info' ? 'info' : 'home'} />
    </PhoneFrame>
  );
}

// ─── Maintenance form ───────────────────────────────────────────────────────
export function MaintenanceScreen({ highlightField }) {
  return (
    <PhoneFrame caption="Maintenance request form">
      <MiniHeader />
      <div className="px-2.5 pt-2">
        <div className="text-[8px] font-bold text-gray-900 mb-0.5">Maintenance Request</div>
        <div className="text-[6px] text-gray-400 mb-1.5">Let us know about any issues</div>
        <div className="bg-white rounded-md border border-gray-100 p-2 space-y-1.5 shadow-sm">
          <Highlight active={highlightField === 'category'}>
            <div>
              <div className="text-[6px] font-semibold text-gray-600">Category <span className="text-red-500">*</span></div>
              <div className="bg-white rounded border border-gray-200 px-1.5 py-1 text-[6px] text-gray-400">Select a category</div>
            </div>
          </Highlight>
          <Highlight active={highlightField === 'urgency'}>
            <div>
              <div className="text-[6px] font-semibold text-gray-600 mb-0.5">Urgency <span className="text-red-500">*</span></div>
              <div className="grid grid-cols-3 gap-0.5">
                <div className="text-[5px] text-center py-1 rounded bg-green-50 text-green-700 border border-green-200 font-semibold">Low</div>
                <div className="text-[5px] text-center py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">Med</div>
                <div className="text-[5px] text-center py-1 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">High</div>
              </div>
            </div>
          </Highlight>
          <Highlight active={highlightField === 'description'}>
            <div>
              <div className="text-[6px] font-semibold text-gray-600">Description <span className="text-red-500">*</span></div>
              <div className="bg-white rounded border border-gray-200 px-1.5 py-2 text-[5px] text-gray-400 leading-tight">Describe the issue...</div>
            </div>
          </Highlight>
          <Highlight active={highlightField === 'photo'}>
            <div>
              <div className="text-[6px] font-semibold text-gray-600">Photo <span className="text-gray-400 font-normal">(optional)</span></div>
              <div className="flex items-center justify-center h-8 rounded border-2 border-dashed border-gray-200 bg-gray-50">
                <span className="text-[6px] text-gray-400">📷 Add a photo</span>
              </div>
            </div>
          </Highlight>
          <Highlight active={highlightField === 'submit'}>
            <div className="bg-green-600 text-white text-[7px] font-semibold text-center py-1.5 rounded-md">Submit Request</div>
          </Highlight>
        </div>
      </div>
    </PhoneFrame>
  );
}

// ─── Maintenance success state ──────────────────────────────────────────────
export function MaintenanceSuccessScreen() {
  return (
    <PhoneFrame caption="Request submitted successfully">
      <MiniHeader />
      <div className="px-2.5 pt-4 flex flex-col items-center text-center">
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mb-2">
          <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-[8px] font-bold text-gray-900">Request submitted</div>
        <div className="text-[6px] text-gray-400 mt-0.5">We will get back to you soon.</div>
      </div>
    </PhoneFrame>
  );
}

// ─── Laundry status page ────────────────────────────────────────────────────
export function LaundryScreen({ highlightMachine }) {
  const machines = [
    { name: 'Washer', icon: '🧺', status: 'Available', color: 'bg-green-50', dot: 'bg-green-500', text: 'text-green-700', id: 'washer' },
    { name: 'Dryer', icon: '💨', status: 'In Use', color: 'bg-amber-50', dot: 'bg-amber-500', text: 'text-amber-700', id: 'dryer' },
  ];
  return (
    <PhoneFrame caption="Laundry machine status">
      <MiniHeader />
      <div className="px-2.5 pt-2 space-y-1.5">
        <div className="text-[8px] font-bold text-gray-900">Laundry Status</div>
        <div className="text-[6px] text-gray-400">Real-time status — honor system</div>
        {machines.map(m => (
          <Highlight key={m.id} active={highlightMachine === m.id}>
            <div className="bg-white rounded-md border border-gray-100 overflow-hidden shadow-sm">
              <div className={`${m.color} px-2 py-1.5 flex items-center justify-between`}>
                <div className="flex items-center gap-1">
                  <span className="text-[10px]">{m.icon}</span>
                  <span className="text-[7px] font-bold text-gray-900">{m.name}</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
                  <span className={`text-[6px] font-semibold ${m.text}`}>{m.status}</span>
                </div>
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[5px] text-gray-400 mb-1">Update status:</div>
                <div className="grid grid-cols-3 gap-0.5">
                  <div className="text-[5px] text-center py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-100">Available</div>
                  <div className="text-[5px] text-center py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-100">In Use</div>
                  <div className="text-[5px] text-center py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-100">Attention</div>
                </div>
              </div>
            </div>
          </Highlight>
        ))}
      </div>
    </PhoneFrame>
  );
}

// ─── Community/Broadcast board ──────────────────────────────────────────────
export function CommunityScreen({ highlightNew }) {
  return (
    <PhoneFrame caption="Community broadcast board">
      <MiniHeader />
      <div className="px-2.5 pt-2 space-y-1.5">
        <div className="text-[8px] font-bold text-gray-900">Broadcast</div>
        <Highlight active={highlightNew}>
          <div className="bg-green-600 text-white text-[7px] font-semibold text-center py-1.5 rounded-md">+ New Post</div>
        </Highlight>
        {/* Sample post */}
        <div className="bg-white rounded-md border border-gray-100 overflow-hidden shadow-sm">
          <div className="flex">
            <div className="w-0.5 bg-amber-400" />
            <div className="p-2 flex-1">
              <div className="flex items-center gap-1 mb-1">
                <div className="w-4 h-4 rounded-full bg-green-600 flex items-center justify-center">
                  <span className="text-[5px] text-white">H</span>
                </div>
                <span className="text-[6px] font-semibold text-gray-900">Host</span>
                <span className="text-[5px] bg-amber-50 text-amber-700 px-1 py-0.5 rounded-full border border-amber-200 font-semibold">Parking</span>
              </div>
              <div className="text-[6px] text-gray-700 leading-tight">Friendly reminder about assigned parking spots...</div>
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

// ─── Invite companions page ─────────────────────────────────────────────────
export function InviteScreen({ highlightField }) {
  return (
    <PhoneFrame caption="Invite travel companions">
      <MiniHeader />
      <div className="px-2.5 pt-2">
        <div className="text-[8px] font-bold text-gray-900 mb-0.5">Your Group</div>
        <div className="text-[6px] text-gray-400 mb-2">2 of 6 spots filled</div>
        <Highlight active={highlightField === 'form'}>
          <div className="bg-white rounded-md border border-gray-100 p-2 shadow-sm space-y-1">
            <div className="text-[7px] font-semibold text-gray-900">Invite a guest</div>
            <div className="bg-gray-50 rounded border border-gray-200 px-1.5 py-1 text-[6px] text-gray-400">Guest name</div>
            <div className="bg-gray-50 rounded border border-gray-200 px-1.5 py-1 text-[6px] text-gray-400">Email address</div>
            <div className="bg-green-600 text-white text-[6px] font-semibold text-center py-1 rounded">Send Invite</div>
          </div>
        </Highlight>
        {/* Member list */}
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-1.5 p-1.5 bg-white rounded-md border border-gray-100">
            <div className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center text-[6px] font-semibold text-green-700">J</div>
            <div className="flex-1">
              <div className="text-[6px] font-medium text-gray-900">Jane Smith <span className="text-[5px] bg-green-100 text-green-700 px-1 py-0.5 rounded-full">You</span></div>
            </div>
          </div>
          <Highlight active={highlightField === 'status'}>
            <div className="flex items-center gap-1.5 p-1.5 bg-white rounded-md border border-gray-100">
              <div className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center text-[6px] font-semibold text-green-700">M</div>
              <div className="flex-1">
                <div className="text-[6px] font-medium text-gray-900">Mike Johnson</div>
              </div>
              <span className="text-[5px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded-full font-semibold">Pending</span>
            </div>
          </Highlight>
        </div>
      </div>
    </PhoneFrame>
  );
}

// ─── Parking info page ──────────────────────────────────────────────────────
export function ParkingScreen({ highlightReport }) {
  return (
    <PhoneFrame caption="Parking info & map">
      <MiniHeader />
      <div className="px-2.5 pt-2 space-y-1.5">
        <div className="text-[8px] font-bold text-gray-900">Parking — Unit A</div>
        <div className="text-[6px] text-gray-400">Your spot is <span className="font-semibold text-green-700">Unit A</span></div>
        {/* Mini parking map */}
        <div className="bg-green-50 rounded-md p-2 border border-green-100">
          <div className="flex gap-1 justify-center mb-1">
            <div className="w-12 h-8 rounded border-2 border-green-500 bg-green-100 flex items-center justify-center">
              <span className="text-[7px] font-bold text-green-700">A</span>
            </div>
            <div className="w-12 h-8 rounded border border-gray-300 border-dashed bg-gray-50 flex items-center justify-center">
              <span className="text-[7px] font-bold text-gray-400">B</span>
            </div>
          </div>
          <div className="text-[5px] text-center text-gray-500">Coqui Lane</div>
        </div>
        <Highlight active={highlightReport}>
          <div className="bg-amber-50 border border-amber-100 rounded-md p-1.5 text-center">
            <span className="text-[6px] font-semibold text-amber-700">🚗 Report Parking Issue</span>
          </div>
        </Highlight>
      </div>
      <MiniBottomNav active="info" />
    </PhoneFrame>
  );
}

// ─── House rules page ───────────────────────────────────────────────────────
export function RulesScreen() {
  const rules = [
    { title: 'Quiet Hours', icon: '🕐', color: 'bg-blue-50' },
    { title: 'No Smoking', icon: '🚭', color: 'bg-red-50' },
    { title: 'Pets Policy', icon: '🐾', color: 'bg-amber-50' },
    { title: 'Checkout', icon: '🚪', color: 'bg-purple-50' },
  ];
  return (
    <PhoneFrame caption="House rules & guidelines">
      <MiniHeader />
      <div className="px-2.5 pt-2 space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[8px] font-bold text-gray-900">House Rules</div>
          <span className="text-[5px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded-full">4 sections</span>
        </div>
        {rules.map(r => (
          <div key={r.title} className="bg-white rounded-md border border-gray-50 px-2 py-1.5 flex items-center gap-1.5 shadow-sm">
            <div className={`w-4 h-4 rounded flex items-center justify-center text-[8px] ${r.color}`}>{r.icon}</div>
            <span className="text-[7px] font-semibold text-gray-900 flex-1">{r.title}</span>
            <svg className="w-2 h-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
        ))}
      </div>
    </PhoneFrame>
  );
}
