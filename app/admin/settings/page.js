'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { auth } from '@/lib/firebase';
import { useDocument } from '@/hooks/useFirestore';
import ImageUpload from '@/components/ui/ImageUpload';
import Parking from '@/components/guest/Parking';
import { getUnits } from '@/lib/units';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent';

const ICON_OPTIONS = [
  { value: 'clock', label: 'Clock' },
  { value: 'no-smoking', label: 'No Smoking' },
  { value: 'pet', label: 'Pet' },
  { value: 'trash', label: 'Trash' },
  { value: 'pool', label: 'Pool' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'fire', label: 'Fire' },
  { value: 'key', label: 'Key' },
];

// ─── Accordion Section ────────────────────────────────────────────────────────
function Section({ title, open, onToggle, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100 pt-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
      {message}
    </div>
  );
}

// ─── ICS Sync Section ─────────────────────────────────────────────────────────
function IcsSyncSection({ form, set, openSections, toggleSection }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const apiCall = useCallback(async (url, opts = {}) => {
    const token = await auth.currentUser?.getIdToken();
    return fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    });
  }, []);

  async function handleSync(unitId = null) {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiCall('/api/admin/sync-ics', {
        method: 'POST',
        body: JSON.stringify(unitId ? { unitId } : {}),
      });
      const data = await res.json();
      setSyncResult(data.success ? data.data : { errors: [data.error] });
    } catch (err) {
      setSyncResult({ errors: [err.message] });
    } finally {
      setSyncing(false);
    }
  }

  function updateFeed(idx, field, value) {
    const feeds = [...(form.icsFeeds || [])];
    feeds[idx] = { ...feeds[idx], [field]: value };
    set('icsFeeds', feeds);
  }

  if (!form?.icsFeeds) return null;

  return (
    <Section title="Airbnb Calendar Sync" open={openSections.icsSync} onToggle={() => toggleSection('icsSync')}>
      <p className="text-xs text-gray-500 -mt-1 mb-3">
        Paste your Airbnb iCal export URL for each unit. The system syncs every 30 minutes and auto-creates bookings + cleaning jobs.
      </p>

      {form.icsFeeds.map((feed, idx) => (
        <div key={feed.unitId} className="mb-4 p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">{feed.unitName}</span>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={feed.enabled}
                onChange={(e) => updateFeed(idx, 'enabled', e.target.checked)}
                className="rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              Enabled
            </label>
          </div>

          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono"
            placeholder="https://www.airbnb.com/calendar/ical/..."
            value={feed.icsUrl}
            onChange={(e) => updateFeed(idx, 'icsUrl', e.target.value)}
          />

          {feed.enabled && feed.icsUrl && (
            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSync(feed.unitId)}
              className="mt-2 text-xs font-medium text-green-700 hover:text-green-800 disabled:text-gray-400"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
        </div>
      ))}

      {/* Sync all button */}
      <button
        type="button"
        disabled={syncing || !form.icsFeeds.some((f) => f.enabled && f.icsUrl)}
        onClick={() => handleSync()}
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 transition"
      >
        {syncing ? 'Syncing All Feeds...' : 'Sync All Feeds'}
      </button>

      {/* Sync result */}
      {syncResult && (
        <div className={`mt-3 p-3 rounded-lg text-xs ${syncResult.errors?.length > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {syncResult.errors?.length > 0 ? (
            <div>
              <p className="font-semibold">Sync completed with errors:</p>
              {syncResult.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          ) : (
            <div>
              <p className="font-semibold">Sync complete</p>
              <p>Events: {syncResult.eventsFound} found, {syncResult.created} created, {syncResult.updated} updated, {syncResult.cancelled} cancelled, {syncResult.unchanged} unchanged</p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        To get your Airbnb calendar URL: Airbnb → Hosting → Calendar → Availability Settings → Export Calendar → Copy link.
        Save settings after pasting URLs to persist them.
      </p>
    </Section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: settings, loading } = useDocument('settings', 'property');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [openSections, setOpenSections] = useState({ units: true });
  const [parkingTab, setParkingTab] = useState('A');
  const [wifiTab, setWifiTab] = useState('A');
  const [checkinTab, setCheckinTab] = useState('A');
  const [unitsSaving, setUnitsSaving] = useState(false);

  // Initialize form from Firestore
  useEffect(() => {
    if (settings && !form) {
      setForm({
        propertyName: settings.propertyName || '',
        address: settings.address || '',
        checkInTime: settings.checkInTime || '',
        checkOutTime: settings.checkOutTime || '',
        emergencyContact: settings.emergencyContact || { name: '', phone: '' },
        wifiNetwork: settings.wifiNetwork || '',
        wifiPassword: settings.wifiPassword || '',
        unitWifi: Array.isArray(settings.unitWifi) && settings.unitWifi.length > 0
          ? settings.unitWifi
          : [
              { unitId: 'unit-a', ssid: '', password: '' },
              { unitId: 'unit-b', ssid: '', password: '' },
            ],
        gateCode: settings.gateCode || '',
        lockboxCode: settings.lockboxCode || '',
        checkInSteps: settings.checkInSteps || [],
        unitCheckInSteps: Array.isArray(settings.unitCheckInSteps) && settings.unitCheckInSteps.length > 0
          ? settings.unitCheckInSteps
          : [
              { unitId: 'unit-a', steps: settings.checkInSteps || [] },
              { unitId: 'unit-b', steps: [] },
            ],
        parkingInfo: settings.parkingInfo?.apartmentA
          ? settings.parkingInfo
          : {
              apartmentA: { instructions: '', steps: [], mapImageUrl: '' },
              apartmentB: { instructions: '', steps: [], mapImageUrl: '' },
              generalNotes: '',
            },
        houseRules: settings.houseRules || [],
        propertyPhotos: settings.propertyPhotos || [],
        units: getUnits(settings),
        icsFeeds: Array.isArray(settings.icsFeeds) && settings.icsFeeds.length > 0
          ? settings.icsFeeds
          : (() => {
              const u = getUnits(settings);
              return [
                { unitId: 'unit-a', unitName: u[0]?.name || 'Unit A', icsUrl: '', enabled: false },
                { unitId: 'unit-b', unitName: u[1]?.name || 'Unit B', icsUrl: '', enabled: false },
              ];
            })(),
      });
    }
  }, [settings, form]);

  function toggleSection(key) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      // Mirror unit-a check-in steps to flat checkInSteps for backward compat
      const unitASteps = form.unitCheckInSteps?.find((u) => u.unitId === 'unit-a')?.steps || [];
      await setDoc(doc(db, 'settings', 'property'), {
        ...form,
        checkInSteps: unitASteps,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      setToast('Settings saved!');
    } catch (err) {
      console.error('Save error:', err);
      setToast('Error saving settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex flex-col gap-4 animate-pulse">
        <div className="h-7 bg-gray-200 rounded w-1/3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="px-4 py-6 flex flex-col gap-4">
      <h1 className="text-xl font-bold text-gray-900">Property Settings</h1>
      <p className="text-sm text-gray-500 -mt-2">Edit content shown to guests. Changes appear in real-time.</p>

      {/* 0. Property & Units */}
      <Section title="Property &amp; Units" open={openSections.units} onToggle={() => toggleSection('units')}>
        <p className="text-xs text-gray-500 -mt-1">
          Rename your units here. The names will update everywhere — bookings, calendar, expenses, and revenue.
        </p>
        {form.units.map((unit, i) => (
          <div key={unit.id} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-400 w-14 flex-shrink-0">Unit {i + 1}</span>
            <input
              className={INPUT_CLASS}
              value={unit.name}
              onChange={(e) => {
                const arr = [...form.units];
                arr[i] = { ...arr[i], name: e.target.value };
                set('units', arr);
              }}
              placeholder={`Unit ${i + 1} name`}
            />
          </div>
        ))}
        <button
          type="button"
          disabled={unitsSaving}
          onClick={async () => {
            setUnitsSaving(true);
            try {
              await setDoc(doc(db, 'settings', 'property'), {
                units: form.units,
                updatedAt: new Date().toISOString(),
              }, { merge: true });
              setToast('Unit names saved!');
            } catch (err) {
              console.error('Save units error:', err);
              setToast('Error saving unit names.');
            } finally {
              setUnitsSaving(false);
            }
          }}
          className="w-full py-2.5 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {unitsSaving ? 'Saving...' : 'Save Unit Names'}
        </button>
      </Section>

      {/* A. Property Info */}
      <Section title="Property Info" open={openSections.property} onToggle={() => toggleSection('property')}>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Property Name</label>
          <input className={INPUT_CLASS} value={form.propertyName} onChange={(e) => set('propertyName', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Address</label>
          <input className={INPUT_CLASS} value={form.address} onChange={(e) => set('address', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Check-In Time</label>
            <input className={INPUT_CLASS} value={form.checkInTime} onChange={(e) => set('checkInTime', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Check-Out Time</label>
            <input className={INPUT_CLASS} value={form.checkOutTime} onChange={(e) => set('checkOutTime', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Emergency Contact Name</label>
            <input
              className={INPUT_CLASS}
              value={form.emergencyContact.name}
              onChange={(e) => set('emergencyContact', { ...form.emergencyContact, name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Emergency Contact Phone</label>
            <input
              className={INPUT_CLASS}
              value={form.emergencyContact.phone}
              onChange={(e) => set('emergencyContact', { ...form.emergencyContact, phone: e.target.value })}
            />
          </div>
        </div>
      </Section>

      {/* B. Access Codes */}
      <Section title="Access Codes" open={openSections.access} onToggle={() => toggleSection('access')}>
        {/* Per-unit WiFi */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-2 block">WiFi (per unit)</label>
          <div className="flex gap-2 mb-3">
            {['A', 'B'].map((tab, idx) => (
              <button
                key={tab}
                type="button"
                onClick={() => setWifiTab(tab)}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
                  wifiTab === tab
                    ? 'bg-green-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {form.units?.[idx]?.name || `Unit ${tab}`}
              </button>
            ))}
          </div>
          {(() => {
            const idx = wifiTab === 'A' ? 0 : 1;
            const wifi = form.unitWifi[idx] || { unitId: idx === 0 ? 'unit-a' : 'unit-b', ssid: '', password: '' };
            function updateWifi(field, value) {
              const arr = [...form.unitWifi];
              arr[idx] = { ...wifi, [field]: value };
              set('unitWifi', arr);
            }
            return (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Network Name</label>
                  <input className={INPUT_CLASS} value={wifi.ssid} onChange={(e) => updateWifi('ssid', e.target.value)} placeholder="SSID" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Password</label>
                  <input className={INPUT_CLASS} value={wifi.password} onChange={(e) => updateWifi('password', e.target.value)} placeholder="Password" />
                </div>
              </div>
            );
          })()}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Gate Code</label>
            <input className={INPUT_CLASS} value={form.gateCode} onChange={(e) => set('gateCode', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Lockbox Code</label>
            <input className={INPUT_CLASS} value={form.lockboxCode} onChange={(e) => set('lockboxCode', e.target.value)} />
          </div>
        </div>
      </Section>

      {/* B2. Airbnb Calendar Sync */}
      <IcsSyncSection
        form={form}
        set={set}
        openSections={openSections}
        toggleSection={toggleSection}
      />

      {/* C. Check-In Steps (per unit) */}
      <Section title="Check-In Steps" open={openSections.checkin} onToggle={() => toggleSection('checkin')}>
        {/* Unit tabs */}
        <div className="flex gap-2">
          {['A', 'B'].map((tab, idx) => (
            <button
              key={tab}
              type="button"
              onClick={() => setCheckinTab(tab)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
                checkinTab === tab
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {form.units?.[idx]?.name || `Unit ${tab}`}
            </button>
          ))}
        </div>

        {/* Per-unit step editor */}
        {(() => {
          const unitIdx = checkinTab === 'A' ? 0 : 1;
          const unitId = form.units?.[unitIdx]?.id || (unitIdx === 0 ? 'unit-a' : 'unit-b');
          const entryIdx = form.unitCheckInSteps.findIndex((u) => u.unitId === unitId);
          const entry = form.unitCheckInSteps[entryIdx] || { unitId, steps: [] };
          const steps = entry.steps || [];

          function updateSteps(newSteps) {
            const arr = [...form.unitCheckInSteps];
            if (entryIdx >= 0) {
              arr[entryIdx] = { ...entry, steps: newSteps };
            } else {
              arr.push({ unitId, steps: newSteps });
            }
            set('unitCheckInSteps', arr);
          }

          return (
            <>
              {steps.map((step, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400">Step {i + 1}</span>
                    <div className="flex gap-1">
                      {i > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const s = [...steps];
                            [s[i - 1], s[i]] = [s[i], s[i - 1]];
                            updateSteps(s);
                          }}
                          className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-500 text-xs"
                          aria-label="Move up"
                        >
                          &uarr;
                        </button>
                      )}
                      {i < steps.length - 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const s = [...steps];
                            [s[i], s[i + 1]] = [s[i + 1], s[i]];
                            updateSteps(s);
                          }}
                          className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-500 text-xs"
                          aria-label="Move down"
                        >
                          &darr;
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => updateSteps(steps.filter((_, j) => j !== i))}
                        className="w-7 h-7 rounded bg-white border border-red-200 flex items-center justify-center text-red-500 text-xs"
                        aria-label="Remove step"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  <input
                    className={INPUT_CLASS}
                    placeholder="Step title"
                    value={step.title}
                    onChange={(e) => {
                      const s = [...steps];
                      s[i] = { ...s[i], title: e.target.value };
                      updateSteps(s);
                    }}
                  />
                  <textarea
                    className={INPUT_CLASS + ' resize-none'}
                    rows={2}
                    placeholder="Description"
                    value={step.description}
                    onChange={(e) => {
                      const s = [...steps];
                      s[i] = { ...s[i], description: e.target.value };
                      updateSteps(s);
                    }}
                  />
                  <ImageUpload
                    storagePath={`settings/photos/checkin/${unitId}/step-${i}`}
                    value={step.imageUrl}
                    onChange={(url) => {
                      const s = [...steps];
                      s[i] = { ...s[i], imageUrl: url };
                      updateSteps(s);
                    }}
                    label="Step photo"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => updateSteps([...steps, { title: '', description: '', imageUrl: '' }])}
                className="text-sm text-green-600 font-semibold py-2 hover:underline"
              >
                + Add Step
              </button>
            </>
          );
        })()}
      </Section>

      {/* D. Parking */}
      <Section title="Parking" open={openSections.parking} onToggle={() => toggleSection('parking')}>
        {/* Unit tabs */}
        <div className="flex gap-2">
          {['A', 'B'].map((tab, idx) => (
            <button
              key={tab}
              type="button"
              onClick={() => setParkingTab(tab)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
                parkingTab === tab
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {form.units?.[idx]?.name || `Unit ${tab}`}
            </button>
          ))}
        </div>

        {/* Per-apartment editor */}
        {(() => {
          const aptKey = parkingTab === 'A' ? 'apartmentA' : 'apartmentB';
          const apt = form.parkingInfo[aptKey] || { instructions: '', steps: [], mapImageUrl: '' };

          function updateApt(field, value) {
            set('parkingInfo', {
              ...form.parkingInfo,
              [aptKey]: { ...apt, [field]: value },
            });
          }

          return (
            <div key={aptKey} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Instructions</label>
                <textarea
                  className={INPUT_CLASS + ' resize-none'}
                  rows={3}
                  placeholder={`Parking instructions for ${form.units?.[parkingTab === 'A' ? 0 : 1]?.name || `Unit ${parkingTab}`}`}
                  value={apt.instructions}
                  onChange={(e) => updateApt('instructions', e.target.value)}
                />
              </div>

              <ImageUpload
                storagePath={`settings/photos/parking/apt${parkingTab}`}
                value={apt.mapImageUrl}
                onChange={(url) => updateApt('mapImageUrl', url)}
                label="Map / overview photo"
              />

              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">Parking Steps</label>
                {(apt.steps || []).map((step, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3 mb-2 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-400">Step {i + 1}</span>
                      <div className="flex gap-1">
                        {i > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const steps = [...apt.steps];
                              [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                              updateApt('steps', steps);
                            }}
                            className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-500 text-xs"
                          >
                            &uarr;
                          </button>
                        )}
                        {i < apt.steps.length - 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const steps = [...apt.steps];
                              [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
                              updateApt('steps', steps);
                            }}
                            className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-500 text-xs"
                          >
                            &darr;
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => updateApt('steps', apt.steps.filter((_, j) => j !== i))}
                          className="w-7 h-7 rounded bg-white border border-red-200 flex items-center justify-center text-red-500 text-xs"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                    <input
                      className={INPUT_CLASS}
                      placeholder="Step description"
                      value={step.description}
                      onChange={(e) => {
                        const steps = [...apt.steps];
                        steps[i] = { ...steps[i], description: e.target.value };
                        updateApt('steps', steps);
                      }}
                    />
                    <ImageUpload
                      storagePath={`settings/photos/parking/apt${parkingTab}/step-${i}`}
                      value={step.imageUrl}
                      onChange={(url) => {
                        const steps = [...apt.steps];
                        steps[i] = { ...steps[i], imageUrl: url };
                        updateApt('steps', steps);
                      }}
                      label="Step photo"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateApt('steps', [...(apt.steps || []), { stepNumber: (apt.steps || []).length + 1, description: '', imageUrl: '' }])
                  }
                  className="text-sm text-green-600 font-semibold py-2 hover:underline"
                >
                  + Add Step
                </button>
              </div>
            </div>
          );
        })()}

        {/* General notes */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">General Notes (both apartments)</label>
          <textarea
            className={INPUT_CLASS + ' resize-none'}
            rows={3}
            placeholder="Shared parking rules for all guests"
            value={form.parkingInfo.generalNotes || ''}
            onChange={(e) => set('parkingInfo', { ...form.parkingInfo, generalNotes: e.target.value })}
          />
        </div>

        {/* Guest Preview */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Guest Preview — {form.units?.[parkingTab === 'A' ? 0 : 1]?.name || `Unit ${parkingTab}`}</p>
          <div className="border-[12px] border-gray-800 rounded-[2.5rem] max-w-[375px] mx-auto shadow-xl bg-white overflow-hidden">
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-24 h-1.5 bg-gray-300 rounded-full" />
            </div>
            <div className="px-4 py-3 max-h-[500px] overflow-y-auto">
              <Parking bookingData={{ unit: parkingTab, unitId: parkingTab === 'A' ? 'unit-a' : 'unit-b' }} settings={{ parkingInfo: form.parkingInfo, units: form.units }} />
            </div>
          </div>
        </div>
      </Section>

      {/* E. House Rules */}
      <Section title="House Rules" open={openSections.rules} onToggle={() => toggleSection('rules')}>
        {form.houseRules.map((rule, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400">Rule {i + 1}</span>
              <div className="flex gap-1">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const arr = [...form.houseRules];
                      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                      set('houseRules', arr);
                    }}
                    className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-500 text-xs"
                  >
                    &uarr;
                  </button>
                )}
                {i < form.houseRules.length - 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const arr = [...form.houseRules];
                      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                      set('houseRules', arr);
                    }}
                    className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-500 text-xs"
                  >
                    &darr;
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => set('houseRules', form.houseRules.filter((_, j) => j !== i))}
                  className="w-7 h-7 rounded bg-white border border-red-200 flex items-center justify-center text-red-500 text-xs"
                >
                  &times;
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 mb-0.5 block">Icon</label>
                <select
                  className={INPUT_CLASS}
                  value={rule.icon}
                  onChange={(e) => {
                    const arr = [...form.houseRules];
                    arr[i] = { ...arr[i], icon: e.target.value };
                    set('houseRules', arr);
                  }}
                >
                  {ICON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-0.5 block">Title</label>
                <input
                  className={INPUT_CLASS}
                  value={rule.title}
                  onChange={(e) => {
                    const arr = [...form.houseRules];
                    arr[i] = { ...arr[i], title: e.target.value };
                    set('houseRules', arr);
                  }}
                />
              </div>
            </div>
            <textarea
              className={INPUT_CLASS + ' resize-none'}
              rows={3}
              placeholder="Rule description (each line becomes a separate rule)"
              value={rule.description}
              onChange={(e) => {
                const arr = [...form.houseRules];
                arr[i] = { ...arr[i], description: e.target.value };
                set('houseRules', arr);
              }}
            />
            <ImageUpload
              storagePath={`settings/photos/rules/rule-${i}`}
              value={rule.imageUrl}
              onChange={(url) => {
                const arr = [...form.houseRules];
                arr[i] = { ...arr[i], imageUrl: url };
                set('houseRules', arr);
              }}
              label="Photo (optional)"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => set('houseRules', [...form.houseRules, { icon: 'info', title: '', description: '', imageUrl: '' }])}
          className="text-sm text-green-600 font-semibold py-2 hover:underline"
        >
          + Add Rule Section
        </button>
      </Section>

      {/* F. Property Photos */}
      <Section title="Property Photos" open={openSections.photos} onToggle={() => toggleSection('photos')}>
        <div className="flex flex-wrap gap-3">
          {form.propertyPhotos.map((url, i) => (
            <div key={i} className="relative">
              <img src={url} alt={`Property ${i + 1}`} className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
              <button
                type="button"
                onClick={() => set('propertyPhotos', form.propertyPhotos.filter((_, j) => j !== i))}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-xs"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <ImageUpload
          storagePath="settings/photos/property"
          value=""
          onChange={(url) => {
            if (url) set('propertyPhotos', [...form.propertyPhotos, url]);
          }}
          label=""
        />
      </Section>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed sticky bottom-20 shadow-lg"
      >
        {saving ? 'Saving...' : 'Save All Settings'}
      </button>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}
