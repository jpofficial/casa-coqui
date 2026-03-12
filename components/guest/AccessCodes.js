'use client';

import { useState, useCallback } from 'react';

// ─── Copy button with "Copied!" feedback ──────────────────────────────────────
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers / insecure contexts
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      disabled={!value}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150
        ${copied
          ? 'bg-green-600 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'
        }
        disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {copied ? (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ─── Individual code card ──────────────────────────────────────────────────────
function CodeCard({ icon, iconBg, iconColor, title, label, value, copyLabel, note }) {
  const displayValue = value || null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-4 flex flex-col gap-3">
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg} ${iconColor}`}>
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>

      {/* Code display + copy */}
      <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">{label}</p>
          {displayValue ? (
            <p className="text-base font-mono font-bold text-gray-900 tracking-wider break-all">
              {displayValue}
            </p>
          ) : (
            <p className="text-sm text-gray-400 italic">Not set yet — check back soon</p>
          )}
        </div>
        <CopyButton value={displayValue} label={copyLabel || label} />
      </div>

      {note && (
        <p className="text-xs text-gray-500 leading-snug">{note}</p>
      )}
    </div>
  );
}

// ─── WiFi card (network + password together) ───────────────────────────────────
function WifiCard({ ssid, password }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-4 flex flex-col gap-3">
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-purple-50 text-purple-600">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">WiFi</h3>
      </div>

      {/* Network name */}
      <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Network Name</p>
          {ssid ? (
            <p className="text-base font-mono font-bold text-gray-900 tracking-wider">{ssid}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">Not set yet</p>
          )}
        </div>
        <CopyButton value={ssid} label="network name" />
      </div>

      {/* Password */}
      <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Password</p>
          {password ? (
            <p className="text-base font-mono font-bold text-gray-900 tracking-wider break-all">{password}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">Not set yet</p>
          )}
        </div>
        <CopyButton value={password} label="WiFi password" />
      </div>

      <p className="text-xs text-gray-500 leading-snug">
        Works throughout the property including the patio and pool area.
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AccessCodes({ bookingData, settings }) {
  // Settings take priority, then booking data, then null
  const wifiSsid = settings?.wifiNetwork || bookingData?.wifiSsid || bookingData?.wifi?.ssid || null;
  const wifiPassword = settings?.wifiPassword || bookingData?.wifiPassword || bookingData?.wifi?.password || null;
  const gateCode = settings?.gateCode || bookingData?.gateCode || bookingData?.gate || null;
  const lockboxCode = settings?.lockboxCode || bookingData?.lockboxCode || bookingData?.lockbox || null;

  return (
    <div className="flex flex-col gap-4">
      {/* Heading */}
      <div>
        <h2 className="text-base font-bold text-gray-900">Access Codes</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Everything you need to get in and get connected.
        </p>
      </div>

      {/* Security notice */}
      <div className="flex gap-2.5 items-start bg-amber-50 border border-amber-100 rounded-xl p-3">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5">
          <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-amber-800 leading-snug">
          These codes are private to your booking. Please do not share them with anyone outside your party.
        </p>
      </div>

      {/* WiFi */}
      <WifiCard ssid={wifiSsid} password={wifiPassword} />

      {/* Gate code */}
      <CodeCard
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        }
        iconBg="bg-green-50"
        iconColor="text-green-600"
        title="Gate Code"
        label="4-digit code"
        value={gateCode}
        copyLabel="gate code"
        note="Enter on the keypad to the right of the front gate. The gate swings open automatically — wait for it to fully open before driving in."
      />

      {/* Lockbox code */}
      <CodeCard
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        }
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        title="Lockbox Code"
        label="4-digit code"
        value={lockboxCode}
        copyLabel="lockbox code"
        note="The lockbox is mounted next to your unit door. Push each button in order, then pull the bottom tab down to open. Return the key to the lockbox when you leave."
      />

      {/* Help footer */}
      <p className="text-xs text-center text-gray-400 mt-1">
        Code not working?{' '}
        <a
          href="sms:+1?body=Hi%2C%20I%27m%20having%20trouble%20with%20the%20access%20code."
          className="text-green-600 font-medium underline underline-offset-2"
        >
          Text the host
        </a>
      </p>
    </div>
  );
}
