'use client';

import { useState, useCallback } from 'react';

function CopyBtn({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      disabled={!value}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={`p-1.5 rounded-md transition-colors flex-shrink-0
        ${copied ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'}
        disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
      )}
    </button>
  );
}

/**
 * Compact inline WiFi display for the guest home page.
 * Shows network name and password with copy buttons.
 */
export default function WifiQuickView({ settings, booking }) {
  const ssid = settings?.wifiNetwork || booking?.wifiSsid || booking?.wifi?.ssid || null;
  const password = settings?.wifiPassword || booking?.wifiPassword || booking?.wifi?.password || null;

  if (!ssid && !password) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-purple-50 text-purple-600 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
          </svg>
        </div>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">WiFi</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {ssid && (
          <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Network</p>
              <p className="text-sm font-mono font-semibold text-gray-900 truncate">{ssid}</p>
            </div>
            <CopyBtn value={ssid} label="network name" />
          </div>
        )}
        {password && (
          <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Password</p>
              <p className="text-sm font-mono font-semibold text-gray-900 truncate">{password}</p>
            </div>
            <CopyBtn value={password} label="WiFi password" />
          </div>
        )}
      </div>
    </div>
  );
}
