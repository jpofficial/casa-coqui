'use client';

import { useState, useEffect, useCallback } from 'react';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { auth } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Verdict colors + labels
// ---------------------------------------------------------------------------

const VERDICT_COLORS = {
  raise: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  keep: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  lower: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  no_data: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' },
  no_rate: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' },
  insufficient_data: { bg: 'bg-gray-50', text: 'text-gray-400', border: 'border-gray-200' },
  // Legacy verdicts (from V1 analysis) — kept for backward compat with existing data
  underpriced: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  below_market: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  market_rate: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  above_market: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  premium: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
};

function verdictLabel(verdict, locale) {
  return t(locale, `admin_pricing_verdict_${verdict}`) || verdict;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function CompCountBadge({ compCount }) {
  if (compCount == null || compCount === 0) return null;
  return (
    <span className="text-[10px] text-coqui-800/40" title={`Based on ${compCount} listings`}>
      {compCount} comps
    </span>
  );
}


function BookedBadge({ locale }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-px">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5">
        <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" clipRule="evenodd" />
      </svg>
      {t(locale, 'admin_pricing_booked')}
    </span>
  );
}

function VerdictBadge({ verdict, confidence, locale }) {
  if (confidence != null && confidence < 25 && verdict !== 'insufficient_data') {
    return (
      <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full border bg-gray-50 text-gray-400 border-gray-200">
        {t(locale, 'admin_pricing_needsData')}
      </span>
    );
  }
  const colors = VERDICT_COLORS[verdict] || VERDICT_COLORS.no_rate;
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
      {verdictLabel(verdict, locale)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${months[d.getMonth()]} ${d.getDate()} ${days[d.getDay()]}`;
}

async function apiCall(path, options = {}) {
  await auth.authStateReady();
  if (!auth.currentUser) {
    return { success: false, error: 'Not authenticated. Please refresh and log in.' };
  }
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return parsed || { success: false, error: `Server error (${res.status})` };
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tab: Competitors
// ---------------------------------------------------------------------------

function CompetitorsTab({ activeUnit, locale }) {
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingComp, setEditingComp] = useState(null);
  const [scrapingPrice, setScrapingPrice] = useState(null); // comp id being scraped

  const fetchComps = useCallback(async () => {
    setLoading(true);
    const res = await apiCall(`/api/pricing/competitors?unit=${activeUnit}`);
    if (res.success) setComps(res.data);
    setLoading(false);
  }, [activeUnit]);

  useEffect(() => { fetchComps(); }, [fetchComps]);

  const handleSave = async (data) => {
    if (editingComp) {
      await apiCall(`/api/pricing/competitors/${editingComp.id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    } else {
      await apiCall('/api/pricing/competitors', {
        method: 'POST',
        body: JSON.stringify({ ...data, comp_unit: activeUnit }),
      });
    }
    setShowForm(false);
    setEditingComp(null);
    fetchComps();
  };

  const handleDeactivate = async (id) => {
    await apiCall(`/api/pricing/competitors/${id}`, { method: 'DELETE' });
    fetchComps();
  };

  const handleScrapePrice = async (id) => {
    setScrapingPrice(id);
    try {
      const res = await apiCall(`/api/pricing/competitors/${id}/scrape-price`, { method: 'POST' });
      if (res.success) fetchComps();
    } finally {
      setScrapingPrice(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-cafe-200 p-4 animate-pulse">
            <div className="h-4 bg-cafe-100 rounded w-2/3 mb-2" />
            <div className="h-3 bg-cafe-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {comps.length === 0 && !showForm && (
        <div className="bg-white rounded-2xl border border-cafe-200 p-8 text-center mb-4">
          <p className="text-sm text-coqui-800/60 mb-1 font-medium">{t(locale, 'admin_pricing_noComps')}</p>
          <p className="text-xs text-coqui-800/40">{t(locale, 'admin_pricing_noCompsHint')}</p>
        </div>
      )}

      {/* Competitor cards */}
      <div className="space-y-3 mb-4">
        {comps.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl border border-cafe-200 p-4 shadow-brand">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-semibold text-coqui-700 hover:underline truncate block">
                    {c.name}
                  </a>
                ) : (
                  <p className="text-sm font-semibold text-coqui-900 truncate">{c.name}</p>
                )}
                <p className="text-xs text-coqui-800/50 mt-0.5">
                  {c.bedrooms}BR/{c.bathrooms}BA
                  {c.neighborhood && ` · ${c.neighborhood}`}
                  {c.rating ? ` · ★ ${c.rating}` : ''}
                  {c.review_count ? ` (${c.review_count})` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-coqui-800/50">
                  {c.base_rate > 0 && <span className="font-semibold text-coqui-700">${c.base_rate}{t(locale, 'admin_pricing_perNightShort')}</span>}
                  {c.cleaning_fee > 0 && <span>${c.cleaning_fee} {t(locale, 'admin_pricing_cleaningFee').toLowerCase()}</span>}
                  {c.min_nights > 1 && <span>{c.min_nights} {t(locale, 'admin_pricing_minNights').toLowerCase()}</span>}
                  {c.url && (
                    <button
                      onClick={() => handleScrapePrice(c.id)}
                      disabled={scrapingPrice === c.id}
                      className="text-coqui-600 hover:text-coqui-800 font-medium disabled:opacity-50 transition"
                    >
                      {scrapingPrice === c.id
                        ? t(locale, 'admin_pricing_fetchingPrice')
                        : c.base_rate > 0
                          ? t(locale, 'admin_pricing_refreshPrice')
                          : t(locale, 'admin_pricing_fetchPrice')}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                <button
                  onClick={() => { setEditingComp(c); setShowForm(true); }}
                  className="p-1.5 rounded-lg hover:bg-cafe-100 text-coqui-800/50 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeactivate(c.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition"
                  title={t(locale, 'admin_pricing_deactivate')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add button */}
      {!showForm && (
        <button
          onClick={() => { setEditingComp(null); setShowForm(true); }}
          className="w-full py-3 rounded-xl border-2 border-dashed border-cafe-300 text-sm font-medium text-coqui-800/60 hover:bg-cafe-50 transition"
        >
          + {t(locale, 'admin_pricing_addComp')}
        </button>
      )}

      {/* Competitor form */}
      {showForm && (
        <CompetitorForm
          comp={editingComp}
          locale={locale}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingComp(null); }}
        />
      )}
    </>
  );
}

function CompetitorForm({ comp, locale, onSave, onCancel }) {
  const isEditing = !!comp;
  // When adding, start with URL step; when editing, skip straight to form
  const [step, setStep] = useState(isEditing ? 'form' : 'url');
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeWarning, setScrapeWarning] = useState(null);
  const [form, setForm] = useState({
    name: comp?.name || '',
    bedrooms: comp?.bedrooms ?? '',
    bathrooms: comp?.bathrooms ?? 1,
    cleaning_fee: comp?.cleaning_fee ?? '',
    neighborhood: comp?.neighborhood || '',
    url: comp?.url || '',
    rating: comp?.rating ?? '',
    review_count: comp?.review_count ?? '',
    min_nights: comp?.min_nights ?? 1,
    host_name: comp?.host_name || '',
    max_guests: comp?.max_guests ?? '',
    superhost: comp?.superhost || false,
    notes: comp?.notes || '',
    base_rate: comp?.base_rate ?? '',
  });

  const isValidAirbnbUrl = (u) => /airbnb\.[a-z.]+\/rooms\/\d+/.test(u);

  const handleScrape = async (urlOverride) => {
    const url = urlOverride || scrapeUrl;
    if (!isValidAirbnbUrl(url)) return;
    setScraping(true);
    setScrapeWarning(null);
    try {
      await auth.authStateReady();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/pricing/competitors/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url }),
      });
      const result = await res.json();
      if (result.success) {
        const d = result.data;
        setForm((f) => ({
          ...f,
          name: d.name || f.name,
          bedrooms: d.bedrooms ?? f.bedrooms,
          bathrooms: d.bathrooms ?? f.bathrooms,
          neighborhood: d.neighborhood || f.neighborhood,
          url: d.url || url,
          rating: d.rating ?? f.rating,
          review_count: d.review_count ?? f.review_count,
          min_nights: d.min_nights ?? f.min_nights,
          host_name: d.host_name || f.host_name,
          max_guests: d.max_guests ?? f.max_guests,
          superhost: d.superhost ?? f.superhost,
          base_rate: d.base_rate ?? f.base_rate,
        }));
        if (result.partial) {
          setScrapeWarning(t(locale, 'admin_pricing_scrapePartial'));
        }
        setStep('form');
      } else {
        setScrapeWarning(t(locale, 'admin_pricing_scrapeFailed'));
        setForm((f) => ({ ...f, url: result.partial_data?.url || url }));
        setStep('form');
      }
    } catch {
      setScrapeWarning(t(locale, 'admin_pricing_scrapeFailed'));
      setForm((f) => ({ ...f, url }));
      setStep('form');
    } finally {
      setScraping(false);
    }
  };

  // Auto-trigger fetch on paste
  const handleUrlInput = (e) => {
    const val = e.target.value;
    setScrapeUrl(val);
    if (isValidAirbnbUrl(val) && !scraping) {
      handleScrape(val);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      name: form.name,
      bedrooms: Number(form.bedrooms),
      bathrooms: Number(form.bathrooms),
      cleaning_fee: Number(form.cleaning_fee) || 0,
      neighborhood: form.neighborhood || null,
      url: form.url || null,
      rating: form.rating ? Number(form.rating) : null,
      review_count: form.review_count ? Number(form.review_count) : null,
      min_nights: Number(form.min_nights) || 1,
      host_name: form.host_name || null,
      max_guests: form.max_guests ? Number(form.max_guests) : null,
      superhost: form.superhost || false,
      notes: form.notes || null,
      base_rate: form.base_rate ? Number(form.base_rate) : null,
    });
  };

  const field = (key, label, type = 'text', props = {}) => (
    <div key={key}>
      <label className="block text-xs font-medium text-coqui-800/60 mb-1">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-cafe-200 focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
        {...props}
      />
    </div>
  );

  // ── URL step (add mode only) ──
  if (step === 'url') {
    return (
      <div className="bg-white rounded-2xl border border-cafe-200 p-4 shadow-brand space-y-3">
        <p className="text-sm font-semibold text-coqui-900">{t(locale, 'admin_pricing_addComp')}</p>
        <div>
          <label className="block text-xs font-medium text-coqui-800/60 mb-1">
            {t(locale, 'admin_pricing_scrapeUrl')}
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={scrapeUrl}
              onChange={handleUrlInput}
              placeholder="https://www.airbnb.com/rooms/12345678"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-cafe-200 focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
            />
            <button
              type="button"
              onClick={() => handleScrape()}
              disabled={scraping || !isValidAirbnbUrl(scrapeUrl)}
              className="px-4 py-2 rounded-lg bg-coqui-600 text-white text-sm font-semibold hover:bg-coqui-700 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
            >
              {scraping ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" /></svg>
                  {t(locale, 'admin_pricing_scrapeFetching')}
                </span>
              ) : t(locale, 'admin_pricing_scrapeFetch')}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStep('form')}
          className="text-xs text-coqui-600 hover:underline"
        >
          {t(locale, 'admin_pricing_scrapeOrManual')}
        </button>
        <div className="flex justify-end">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-cafe-200 text-sm text-coqui-800/60 hover:bg-cafe-50 transition">
            {t(locale, 'admin_pricing_cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ── Form step (add or edit) ──
  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-cafe-200 p-4 shadow-brand space-y-3">
      <p className="text-sm font-semibold text-coqui-900">
        {isEditing ? t(locale, 'admin_pricing_editComp') : t(locale, 'admin_pricing_addComp')}
      </p>
      {scrapeWarning && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {scrapeWarning}
        </div>
      )}
      {field('name', t(locale, 'admin_pricing_compName'), 'text', { required: true })}
      <div className="grid grid-cols-3 gap-3">
        {field('bedrooms', t(locale, 'admin_pricing_compBedrooms'), 'number', { required: true, min: 0 })}
        {field('bathrooms', t(locale, 'admin_pricing_compBathrooms'), 'number', { min: 0, step: 0.5 })}
        {field('max_guests', t(locale, 'admin_pricing_compMaxGuests'), 'number', { min: 0 })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field('cleaning_fee', t(locale, 'admin_pricing_compCleaningFee'), 'number', { min: 0, step: 1 })}
        {field('min_nights', t(locale, 'admin_pricing_compMinNights'), 'number', { min: 1 })}
      </div>
      {field('neighborhood', t(locale, 'admin_pricing_compNeighborhood'))}
      {field('url', t(locale, 'admin_pricing_compUrl'), 'url')}
      <div className="grid grid-cols-2 gap-3">
        {field('rating', t(locale, 'admin_pricing_compRating'), 'number', { min: 0, max: 5, step: 0.01 })}
        {field('review_count', t(locale, 'admin_pricing_compReviews'), 'number', { min: 0 })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field('host_name', t(locale, 'admin_pricing_compHostName'))}
        <div>
          <label className="block text-xs font-medium text-coqui-800/60 mb-1">
            {t(locale, 'admin_pricing_compSuperhost')}
          </label>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, superhost: !f.superhost }))}
            className={`w-full px-3 py-2 text-sm rounded-lg border transition ${
              form.superhost
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-medium'
                : 'border-cafe-200 text-coqui-800/40'
            }`}
          >
            {form.superhost ? '★ Superhost' : '—'}
          </button>
        </div>
      </div>
      {field('notes', t(locale, 'admin_pricing_compNotes'))}
      <div className="flex gap-2 pt-1">
        <button type="submit" className="flex-1 py-2.5 rounded-xl bg-coqui-600 text-white text-sm font-semibold hover:bg-coqui-700 transition">
          {t(locale, 'admin_pricing_save')}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-cafe-200 text-sm text-coqui-800/60 hover:bg-cafe-50 transition">
          {t(locale, 'admin_pricing_cancel')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tab: Research
// ---------------------------------------------------------------------------

function ResearchTab({ activeUnit, locale }) {
  const [config, setConfig] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Form state — 'searchLocation' avoids shadowing window.location
  const [searchLocation, setSearchLocation] = useState('');
  const [minBedrooms, setMinBedrooms] = useState(4);
  const [maxBedrooms, setMaxBedrooms] = useState('');
  const [minBathrooms, setMinBathrooms] = useState(1);
  const [maxResults, setMaxResults] = useState(20);
  const [startDate, setStartDate] = useState('');
  const [checkoutDate, setCheckoutDate] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  // Auto-discovered comps
  const [researchComps, setResearchComps] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, compsRes] = await Promise.all([
        apiCall(`/api/pricing/research-config?unit=${activeUnit}`),
        apiCall(`/api/pricing/competitors?unit=${activeUnit}`),
      ]);
      if (configRes.success) {
        const c = configRes.data.config;
        setConfig(c);
        setLastRun(configRes.data.lastRun);
        if (c) {
          setSearchLocation(c.location || '');
          setMinBedrooms(c.min_bedrooms || 4);
          setMaxBedrooms(c.max_bedrooms || '');
          setMinBathrooms(c.min_bathrooms || 1);
          setMaxResults(c.max_results || 20);
          setStartDate(c.start_date || '');
          setCheckoutDate(c.checkout_date || '');
          setMinPrice(c.min_price || '');
          setMaxPrice(c.max_price || '');
        }
      }
      if (compsRes?.success) {
        setResearchComps((compsRes.data || []).filter((c) => c.source === 'research'));
      }
    } catch (err) {
      console.error('[ResearchTab] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeUnit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const res = await apiCall('/api/pricing/research-config', {
      method: 'POST',
      body: JSON.stringify({
        comp_unit: activeUnit,
        location: searchLocation,
        min_bedrooms: minBedrooms,
        max_bedrooms: maxBedrooms ? Number(maxBedrooms) : null,
        min_bathrooms: minBathrooms,
        max_results: maxResults,
        start_date: startDate || null,
        checkout_date: checkoutDate || null,
        min_price: minPrice ? Number(minPrice) : null,
        max_price: maxPrice ? Number(maxPrice) : null,
      }),
    });
    if (res.success) {
      setConfig(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setSaveError(res.error || 'Failed to save config');
    }
    setSaving(false);
  };

  const handleDeactivate = async (id) => {
    await apiCall(`/api/pricing/competitors/${id}`, { method: 'DELETE' });
    fetchData();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-cafe-200 p-6 animate-pulse">
            <div className="h-4 bg-cafe-100 rounded w-2/3 mb-3" />
            <div className="h-3 bg-cafe-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const cliCmd = `node tools/pricing/scripts/market-research.js --unit ${activeUnit}`;

  return (
    <div className="space-y-4">
      {/* Config form */}
      <div className="bg-white rounded-2xl border border-cafe-200 p-4 shadow-brand">
        <h3 className="text-sm font-semibold text-coqui-900 mb-3">
          {t(locale, 'admin_pricing_research_config')}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-coqui-800/70 mb-1">
              {t(locale, 'admin_pricing_research_location')}
            </label>
            <input
              type="text"
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
              placeholder="San Juan, Puerto Rico"
              className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_bedrooms')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={minBedrooms}
                onChange={(e) => setMinBedrooms(Number(e.target.value))}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_maxBedrooms')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                placeholder="—"
                value={maxBedrooms}
                onChange={(e) => setMaxBedrooms(e.target.value)}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_bathrooms')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={minBathrooms}
                onChange={(e) => setMinBathrooms(Number(e.target.value))}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_max')}
              </label>
              <input
                type="number"
                min={5}
                max={50}
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
          </div>

          {/* Price range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_minPrice')}
              </label>
              <input
                type="number"
                min={0}
                placeholder="$0"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_maxPrice')}
              </label>
              <input
                type="number"
                min={0}
                placeholder="$500"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
          </div>

          {/* Check-in / Checkout dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_checkin')}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-coqui-800/70 mb-1">
                {t(locale, 'admin_pricing_research_checkout')}
              </label>
              <input
                type="date"
                value={checkoutDate}
                onChange={(e) => setCheckoutDate(e.target.value)}
                className="w-full border border-cafe-200 rounded-xl px-3 py-2 text-sm focus:border-coqui-500 focus:ring-1 focus:ring-coqui-500 outline-none"
              />
            </div>
          </div>
          <p className="text-[10px] text-coqui-800/40 -mt-2">
            {t(locale, 'admin_pricing_research_dateHint')}
          </p>

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-800">
              {saveError}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !searchLocation.trim()}
            className="w-full py-2.5 rounded-xl bg-coqui-600 text-white text-sm font-bold hover:bg-coqui-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saving
              ? t(locale, 'admin_pricing_analyzing')
              : saved
                ? '✓ ' + t(locale, 'admin_pricing_saved')
                : t(locale, 'admin_pricing_save')}
          </button>
        </div>
      </div>

      {/* Last run card */}
      {lastRun && (
        <div className="bg-white rounded-2xl border border-cafe-200 p-4 shadow-brand">
          <h3 className="text-sm font-semibold text-coqui-900 mb-2">
            {t(locale, 'admin_pricing_research_lastRun')}
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-coqui-800/70 mb-3">
            <span>{t(locale, 'admin_pricing_research_status')}:</span>
            <span className={`font-semibold ${lastRun.status === 'completed' ? 'text-emerald-600' : lastRun.status === 'failed' ? 'text-red-500' : 'text-amber-500'}`}>
              {lastRun.status}
            </span>
            <span>{t(locale, 'admin_pricing_research_found')}:</span>
            <span className="font-medium">{lastRun.listings_found}</span>
            <span>{t(locale, 'admin_pricing_research_saved')}:</span>
            <span className="font-medium">{lastRun.listings_saved}</span>
            <span>{t(locale, 'admin_pricing_research_snapshots')}:</span>
            <span className="font-medium">{lastRun.snapshots_saved}</span>
            {lastRun.duration_ms && (
              <>
                <span>{t(locale, 'admin_pricing_research_duration')}:</span>
                <span className="font-medium">{(lastRun.duration_ms / 1000).toFixed(0)}s</span>
              </>
            )}
            <span>{t(locale, 'admin_pricing_date')}:</span>
            <span className="font-medium">{new Date(lastRun.started_at).toLocaleString()}</span>
          </div>
          {lastRun.error_log && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2 mb-3">{lastRun.error_log}</p>
          )}
        </div>
      )}

      {/* CLI command */}
      {config && (
        <div className="bg-coqui-50 rounded-2xl border border-coqui-200 p-4">
          <p className="text-xs font-medium text-coqui-800 mb-1.5">
            {t(locale, 'admin_pricing_research_runCmd')}
          </p>
          <code className="block bg-coqui-900 text-coqui-100 rounded-xl px-3 py-2 text-xs font-mono break-all select-all">
            {cliCmd}
          </code>
          <p className="text-[10px] text-coqui-800/50 mt-1.5">
            {t(locale, 'admin_pricing_research_runHint')}
          </p>
        </div>
      )}

      {/* Auto-discovered competitors */}
      {researchComps.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-coqui-900 mb-2">
            {t(locale, 'admin_pricing_research_discovered')} ({researchComps.length})
          </h3>
          <div className="space-y-2">
            {researchComps.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl border border-cafe-200 p-3 shadow-brand">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-semibold text-coqui-700 hover:underline truncate block">
                        {c.name}
                      </a>
                    ) : (
                      <p className="text-sm font-semibold text-coqui-900 truncate">{c.name}</p>
                    )}
                    <p className="text-xs text-coqui-800/50 mt-0.5">
                      {c.bedrooms}BR/{c.bathrooms}BA
                      {c.neighborhood && ` · ${c.neighborhood}`}
                      {c.rating ? ` · ★ ${c.rating}` : ''}
                      {c.review_count ? ` (${c.review_count})` : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      {c.base_rate > 0 && (
                        <span className="font-semibold text-coqui-700">${c.base_rate}{t(locale, 'admin_pricing_perNightShort')}</span>
                      )}
                      <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 rounded px-1 py-px font-medium">
                        {t(locale, 'admin_pricing_research_autoTag')}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeactivate(c.id)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium ml-2 shrink-0"
                  >
                    {t(locale, 'admin_pricing_deactivate')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season badge colors
// ---------------------------------------------------------------------------

const SEASON_COLORS = {
  high: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  shoulder: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  low: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
};

function SeasonBadge({ season, locale }) {
  const colors = SEASON_COLORS[season] || SEASON_COLORS.low;
  const label = t(locale, `admin_pricing_season_${season}`) || season;
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab: Autopilot
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI Advisor Card — Claude-powered pricing recommendations
// ---------------------------------------------------------------------------

function AdvisorCard({ activeUnit, locale }) {
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Chat state
  const [chatContext, setChatContext] = useState(null); // { dataMessage, toolUseId, initialAdvice }
  const [chatMessages, setChatMessages] = useState([]); // [{ role, content }]
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);

  const handleGetAdvice = async () => {
    setLoading(true);
    setError(null);
    setChatMessages([]);
    setChatContext(null);
    try {
      const res = await apiCall('/api/pricing/advisor', {
        method: 'POST',
        body: JSON.stringify({ unit: activeUnit }),
      });
      if (res.success) {
        setAdvice(res.data.advice);
        setChatContext({
          dataMessage: res.data.dataMessage,
          toolUseId: res.data.toolUseId,
          initialAdvice: res.data.advice,
        });
      } else {
        setError(res.error || t(locale, 'admin_pricing_advisor_error'));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    const msg = chatInput.trim();
    if (!msg || !chatContext || chatSending) return;

    setChatInput('');
    setChatSending(true);
    const newMessages = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);

    try {
      const res = await apiCall('/api/pricing/advisor', {
        method: 'POST',
        body: JSON.stringify({
          unit: activeUnit,
          message: msg,
          context: {
            ...chatContext,
            followUps: chatMessages,
          },
        }),
      });
      if (res.success) {
        const { text, updatedAdvice, newToolUseId } = res.data;
        if (text) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: text }]);
        }
        if (updatedAdvice) {
          setAdvice(updatedAdvice);
          setChatContext(prev => ({
            ...prev,
            initialAdvice: prev.initialAdvice, // keep original for context
            toolUseId: newToolUseId || prev.toolUseId,
          }));
          if (!text) {
            setChatMessages(prev => [...prev, { role: 'assistant', content: t(locale, 'admin_pricing_advisor_updated') }]);
          }
        }
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: res.error || 'Error' }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: err.message }]);
    } finally {
      setChatSending(false);
    }
  };

  // Reset when unit changes
  useEffect(() => {
    setAdvice(null);
    setError(null);
    setChatMessages([]);
    setChatContext(null);
  }, [activeUnit]);

  return (
    <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand overflow-hidden">
      <div className="px-4 py-3 border-b border-cafe-100 flex items-center justify-between">
        <h2 className="text-sm font-bold text-coqui-900 flex items-center gap-1.5">
          <span className="text-base">✦</span>
          {t(locale, 'admin_pricing_advisor_title')}
        </h2>
        <button
          onClick={handleGetAdvice}
          disabled={loading}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
            loading
              ? 'bg-cafe-100 text-coqui-800/50 cursor-wait'
              : 'bg-coqui-600 text-white hover:bg-coqui-700'
          }`}
        >
          {loading ? t(locale, 'admin_pricing_advisor_loading') : t(locale, advice ? 'admin_pricing_advisor_refresh' : 'admin_pricing_advisor_get')}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 text-sm text-red-800 border-b border-red-100">
          {error}
        </div>
      )}

      {!advice && !loading && !error && (
        <div className="px-4 py-6 text-center text-xs text-coqui-800/50">
          {t(locale, 'admin_pricing_advisor_cta')}
        </div>
      )}

      {loading && (
        <div className="px-4 py-8 text-center">
          <div className="inline-block w-5 h-5 border-2 border-coqui-600 border-t-transparent rounded-full animate-spin mb-2" />
          <p className="text-xs text-coqui-800/60">{t(locale, 'admin_pricing_advisor_loading')}</p>
        </div>
      )}

      {advice && (
        <div className="p-4 space-y-4">
          {/* Summary */}
          <div className="bg-coqui-50 border border-coqui-200 rounded-xl px-3 py-2.5 text-sm text-coqui-900 leading-relaxed">
            {advice.summary}
          </div>

          {/* Rate grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-cafe-50 rounded-xl p-3 text-center">
              <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                {t(locale, 'admin_pricing_advisor_weekday')}
              </div>
              <div className="text-2xl font-bold text-coqui-900">${advice.weekdayRate}</div>
            </div>
            <div className="bg-cafe-50 rounded-xl p-3 text-center">
              <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                {t(locale, 'admin_pricing_advisor_weekend')}
              </div>
              <div className="text-2xl font-bold text-coqui-900">${advice.weekendRate}</div>
            </div>
            <div className="bg-cafe-50 rounded-xl p-3 text-center">
              <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                {t(locale, 'admin_pricing_advisor_weekly')}
              </div>
              <div className="text-2xl font-bold text-coqui-900">{advice.weeklyDiscount}%</div>
            </div>
            <div className="bg-cafe-50 rounded-xl p-3 text-center">
              <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                {t(locale, 'admin_pricing_advisor_monthly')}
              </div>
              <div className="text-2xl font-bold text-coqui-900">{advice.monthlyDiscount}%</div>
            </div>
          </div>

          {/* Daily rates */}
          {advice.dailyRates?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-coqui-900 mb-2">
                {t(locale, 'admin_pricing_advisor_daily')}
              </h4>
              <div className="border border-cafe-200 rounded-xl overflow-hidden divide-y divide-cafe-50 max-h-72 overflow-y-auto">
                {advice.dailyRates.map((day) => {
                  const d = new Date(day.date + 'T12:00:00');
                  const dayName = d.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', { weekday: 'short' });
                  const dateStr = d.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', { month: 'short', day: 'numeric' });
                  const isWeekend = d.getDay() === 5 || d.getDay() === 6;
                  return (
                    <div key={day.date} className={`px-3 py-2 flex items-center gap-2 ${isWeekend ? 'bg-coqui-50/50' : 'bg-white'}`}>
                      <div className="w-16 shrink-0">
                        <div className="text-xs font-semibold text-coqui-900">{dateStr}</div>
                        <div className="text-[10px] text-coqui-800/50">{dayName}</div>
                      </div>
                      <div className="w-16 shrink-0 text-center">
                        <span className="text-lg font-bold text-coqui-900">${day.rate}</span>
                      </div>
                      <div className="flex-1 text-[11px] text-coqui-800/60 truncate">
                        {day.note}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          {advice.actions?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-coqui-900 mb-2">
                {t(locale, 'admin_pricing_advisor_actions')}
              </h4>
              <ul className="space-y-1.5">
                {advice.actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-coqui-800">
                    <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-coqui-100 text-coqui-700 flex items-center justify-center text-[10px] font-bold">
                      {i + 1}
                    </span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Alerts */}
          {advice.alerts?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-coqui-900 mb-2">
                {t(locale, 'admin_pricing_advisor_alerts')}
              </h4>
              <div className="space-y-1.5">
                {advice.alerts.map((alert, i) => (
                  <div
                    key={i}
                    className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900"
                  >
                    {alert}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div className="text-[10px] text-coqui-800/40 text-right">
            {t(locale, 'admin_pricing_advisor_confidence')}: {advice.confidence}
          </div>

          {/* Chat thread */}
          {chatMessages.length > 0 && (
            <div className="border-t border-cafe-100 pt-3 space-y-2 max-h-60 overflow-y-auto">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-xs px-3 py-2 rounded-lg max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-coqui-600 text-white ml-auto'
                      : 'bg-cafe-50 text-coqui-900'
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {chatSending && (
                <div className="bg-cafe-50 text-coqui-800/50 text-xs px-3 py-2 rounded-lg max-w-[85%] animate-pulse">
                  {t(locale, 'admin_pricing_advisor_thinking')}
                </div>
              )}
            </div>
          )}

          {/* Chat input */}
          {chatContext && (
            <form onSubmit={handleSendChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t(locale, 'admin_pricing_advisor_chat_placeholder')}
                disabled={chatSending}
                className="flex-1 text-xs border border-cafe-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-coqui-500 focus:border-coqui-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={chatSending || !chatInput.trim()}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-coqui-600 text-white hover:bg-coqui-700 disabled:opacity-50 disabled:cursor-not-allowed transition shrink-0"
              >
                {t(locale, 'admin_pricing_advisor_send')}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FreshnessBar — shows data age with color-coded staleness
// ---------------------------------------------------------------------------

function FreshnessBar({ lastRun, running, onRunAnalysis, locale }) {
  let ageText, colorClass;

  if (!lastRun?.startedAt) {
    ageText = t(locale, 'admin_pricing_freshness_none');
    colorClass = 'bg-gray-100 border-gray-200 text-gray-600';
  } else {
    const ageMs = Date.now() - new Date(lastRun.startedAt).getTime();
    const ageHours = ageMs / 3600000;
    const ageDays = ageHours / 24;

    if (ageHours < 1) {
      ageText = t(locale, 'admin_pricing_freshness_minutes').replace('{n}', Math.max(1, Math.round(ageMs / 60000)));
    } else if (ageHours < 24) {
      ageText = t(locale, 'admin_pricing_freshness_hours').replace('{n}', Math.round(ageHours));
    } else {
      ageText = t(locale, 'admin_pricing_freshness_days').replace('{n}', Math.round(ageDays));
    }

    if (ageHours < 24) {
      colorClass = 'bg-emerald-50 border-emerald-200 text-emerald-800';
    } else if (ageDays <= 3) {
      colorClass = 'bg-amber-50 border-amber-200 text-amber-800';
    } else {
      colorClass = 'bg-red-50 border-red-200 text-red-800';
    }
  }

  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-2.5 mb-4 ${colorClass}`}>
      <span className="text-xs font-medium">{ageText}</span>
      <button
        onClick={onRunAnalysis}
        disabled={running}
        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
          running
            ? 'bg-white/60 text-current cursor-wait'
            : 'bg-white text-coqui-800 hover:bg-white/80 shadow-sm'
        }`}
      >
        {running
          ? t(locale, 'admin_pricing_autopilot_running')
          : t(locale, 'admin_pricing_autopilot_runNow')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autopilot Tab (Recommendations)
// ---------------------------------------------------------------------------

function AutopilotTab({ activeUnit, locale }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [expandedDate, setExpandedDate] = useState(null);
  const [dateSnapshots, setDateSnapshots] = useState({});
  const [comps, setComps] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, compsRes] = await Promise.all([
        apiCall(`/api/pricing/autopilot?unit=${activeUnit}&days=30`),
        apiCall(`/api/pricing/competitors?unit=${activeUnit}`),
      ]);
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error || 'Failed to load data');
      }
      if (compsRes.success) setComps(compsRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeUnit]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRunAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiCall('/api/pricing/autopilot', {
        method: 'POST',
        body: JSON.stringify({ unit: activeUnit, days: 30 }),
      });
      if (res.success) {
        await loadData();
      } else {
        setError(res.error || 'Analysis failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const toggleDateExpand = async (date) => {
    if (expandedDate === date) {
      setExpandedDate(null);
      return;
    }
    setExpandedDate(date);
    if (!dateSnapshots[date]) {
      const res = await apiCall(`/api/pricing/snapshots?unit=${activeUnit}&date=${date}`);
      if (res.success) {
        setDateSnapshots(prev => ({ ...prev, [date]: res.data }));
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-cafe-200 p-6 animate-pulse">
            <div className="h-4 bg-cafe-100 rounded w-2/3 mb-3" />
            <div className="h-3 bg-cafe-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const recs = data?.recommendations || [];
  const lastRun = data?.lastRun;
  const next14 = recs.slice(0, 14);

  // Weekly summary — average weekday/weekend rates + weekly discount
  const weekdayRecs = next14.filter(r => r.dayType === 'weekday' && r.recNightlyRate);
  const weekendRecs = next14.filter(r => (r.dayType === 'friday' || r.dayType === 'saturday') && r.recNightlyRate);
  const avgWeekday = weekdayRecs.length > 0
    ? Math.round(weekdayRecs.reduce((s, r) => s + r.recNightlyRate, 0) / weekdayRecs.length)
    : null;
  const avgWeekend = weekendRecs.length > 0
    ? Math.round(weekendRecs.reduce((s, r) => s + r.recNightlyRate, 0) / weekendRecs.length)
    : null;
  const avgWeeklyPct = recs.length > 0
    ? Math.round(recs.filter(r => r.recWeeklyPct).reduce((s, r) => s + r.recWeeklyPct, 0) / recs.filter(r => r.recWeeklyPct).length)
    : null;

  return (
    <div className="space-y-4">
      {/* Freshness bar */}
      <FreshnessBar lastRun={lastRun} running={running} onRunAnalysis={handleRunAnalysis} locale={locale} />

      {/* AI Advisor */}
      <AdvisorCard activeUnit={activeUnit} locale={locale} />

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Hero: "Set on Airbnb" card */}
      <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand overflow-hidden">
        <div className="px-4 py-3 border-b border-cafe-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-coqui-900">
            {t(locale, 'admin_pricing_autopilot_setOnAirbnb')}
          </h2>
          <span className="text-[10px] text-coqui-800/50">
            {t(locale, 'admin_pricing_autopilot_next14')}
          </span>
        </div>

        {next14.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-coqui-800/50">
            {t(locale, 'admin_pricing_autopilot_noData')}
          </div>
        ) : (
          <div className="divide-y divide-cafe-50">
            {next14.map((rec) => {
              const isExpanded = expandedDate === rec.date;
              const snaps = dateSnapshots[rec.date];
              return (
                <div key={rec.date}>
                  <button
                    type="button"
                    onClick={() => toggleDateExpand(rec.date)}
                    className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-cafe-50/30 transition text-left"
                  >
                    {/* Expand chevron */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"
                      className={`w-3 h-3 text-coqui-800/30 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>

                    {/* Date */}
                    <div className="w-20 shrink-0">
                      <div className="text-xs font-semibold text-coqui-900">
                        {formatDate(rec.date)}
                      </div>
                    </div>

                    {/* Season badge */}
                    <div className="w-16 shrink-0">
                      {rec.season && <SeasonBadge season={rec.season} locale={locale} />}
                    </div>

                    {/* Recommended rate */}
                    <div className="flex-1 text-center">
                      {rec.recNightlyRate ? (
                        <span className="text-lg font-bold text-coqui-900">
                          ${rec.recNightlyRate}
                        </span>
                      ) : (
                        <span className="text-sm text-coqui-800/30">—</span>
                      )}
                    </div>

                    {/* Weekly discount */}
                    <div className="w-12 text-center shrink-0">
                      {rec.recWeeklyPct ? (
                        <span className="text-[11px] font-medium text-coqui-800/70">
                          {rec.recWeeklyPct}%w
                        </span>
                      ) : null}
                    </div>

                    {/* Verdict */}
                    <div className="w-24 shrink-0 text-right">
                      <VerdictBadge verdict={rec.verdict} confidence={rec.confidence} locale={locale} />
                    </div>

                    {/* Comp count */}
                    <div className="w-12 shrink-0 text-right">
                      <CompCountBadge compCount={rec.comp_count} />
                    </div>
                  </button>

                  {/* Expanded: per-comp TCPNs */}
                  {isExpanded && (
                    <div className="px-4 pb-3 pl-8">
                      {!snaps ? (
                        <div className="text-xs text-coqui-800/40 animate-pulse py-2">{t(locale, 'admin_pricing_loading_comps')}</div>
                      ) : snaps.length === 0 ? (
                        <div className="text-xs text-coqui-800/40 py-2">{t(locale, 'admin_pricing_no_comp_data')}</div>
                      ) : (
                        <div className="bg-cafe-50/50 rounded-lg divide-y divide-cafe-100">
                          {snaps.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                {s.url ? (
                                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                                    className="font-medium text-coqui-700 hover:underline truncate">
                                    {s.name}
                                  </a>
                                ) : (
                                  <span className="font-medium text-coqui-900 truncate">{s.name}</span>
                                )}
                                {!s.available && (
                                  <span className="text-[9px] bg-gray-100 text-gray-500 rounded px-1 py-px">{t(locale, 'admin_pricing_booked')}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                {s.nightly_rate > 0 && (
                                  <span className="text-coqui-800/60">${Math.round(s.nightly_rate)}/n</span>
                                )}
                                {s.tcpn > 0 && (
                                  <span className="font-semibold text-coqui-900">${Math.round(s.tcpn)} TCPN</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Weekly summary card */}
      {(avgWeekday || avgWeekend) && (
        <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand p-4">
          <h3 className="text-xs font-bold text-coqui-900 mb-3">
            {t(locale, 'admin_pricing_autopilot_weeklySummary')}
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            {avgWeekday && (
              <div>
                <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                  {t(locale, 'admin_pricing_autopilot_weekdays')}
                </div>
                <div className="text-xl font-bold text-coqui-900">${avgWeekday}</div>
              </div>
            )}
            {avgWeekend && (
              <div>
                <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                  {t(locale, 'admin_pricing_autopilot_weekends')}
                </div>
                <div className="text-xl font-bold text-coqui-900">${avgWeekend}</div>
              </div>
            )}
            {avgWeeklyPct && (
              <div>
                <div className="text-[10px] uppercase text-coqui-800/50 mb-1">
                  {t(locale, 'admin_pricing_autopilot_weeklyDiscount')}
                </div>
                <div className="text-xl font-bold text-coqui-900">{avgWeeklyPct}%</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Comp Set */}
      {comps.length > 0 && (
        <details className="bg-white rounded-2xl border border-cafe-200 shadow-brand overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-coqui-900 hover:bg-cafe-50/50 transition">
            {t(locale, 'admin_pricing_compSet')} ({comps.length})
          </summary>
          <div className="border-t border-cafe-100 divide-y divide-cafe-50">
            {comps.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-coqui-700 hover:underline truncate block">
                      {c.name}
                    </a>
                  ) : (
                    <p className="text-sm font-medium text-coqui-900 truncate">{c.name}</p>
                  )}
                  <p className="text-xs text-coqui-800/50">
                    {c.bedrooms}BR{c.bathrooms ? `/${c.bathrooms}BA` : ''}
                    {c.neighborhood && ` · ${c.neighborhood}`}
                    {c.rating ? ` · ★ ${c.rating}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  {c.base_rate > 0 && <p className="text-sm font-bold text-coqui-900">${c.base_rate}</p>}
                  {c.cleaning_fee > 0 && <p className="text-[10px] text-coqui-800/40">+${c.cleaning_fee} clean</p>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Run history card */}
      <div className="bg-white rounded-2xl border border-cafe-200 shadow-brand p-4">
        <h3 className="text-xs font-bold text-coqui-900 mb-3">
          {t(locale, 'admin_pricing_autopilot_runHistory')}
        </h3>

        {lastRun ? (
          <div className="text-xs text-coqui-800/70 space-y-1">
            <div className="flex justify-between">
              <span>{t(locale, 'admin_pricing_autopilot_lastRun')}</span>
              <span className="font-medium">{new Date(lastRun.startedAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>{t(locale, 'admin_pricing_research_status')}</span>
              <span className={`font-medium ${lastRun.status === 'completed' ? 'text-emerald-700' : lastRun.status === 'failed' ? 'text-red-600' : 'text-amber-600'}`}>
                {lastRun.status}
              </span>
            </div>
            {lastRun.durationMs && (
              <div className="flex justify-between">
                <span>{t(locale, 'admin_pricing_research_duration')}</span>
                <span className="font-medium">{(lastRun.durationMs / 1000).toFixed(1)}s</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t(locale, 'admin_pricing_autopilot_analyzed')}</span>
              <span className="font-medium">{lastRun.analysisOk || 0} {t(locale, 'admin_pricing_recommendations').toLowerCase()}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-coqui-800/50">
            {t(locale, 'admin_pricing_autopilot_noRuns')}
          </p>
        )}

        {/* CLI hint */}
        <div className="mt-3 pt-3 border-t border-cafe-100">
          <p className="text-[10px] text-coqui-800/40 mb-1">
            {t(locale, 'admin_pricing_autopilot_cliHint')}
          </p>
          <code className="block text-[10px] bg-cafe-50 text-coqui-800 rounded px-2 py-1.5 font-mono">
            node tools/pricing/scripts/autopilot.js --unit {activeUnit}
          </code>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page (3-tab layout)
// ---------------------------------------------------------------------------

const TABS = ['recommendations', 'competitors', 'research'];

export default function PricingPage() {
  const { locale } = useLocale();
  const [activeTab, setActiveTab] = useState('recommendations');
  const [activeUnit, setActiveUnit] = useState('unit-a');

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-display text-coqui-900">
          {t(locale, 'admin_pricing_title')}
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-cafe-100 rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition ${
              activeTab === tab
                ? 'bg-white text-coqui-900 shadow-sm'
                : 'text-coqui-800/50 hover:text-coqui-800/80'
            }`}
          >
            {t(locale, `admin_pricing_tab_${tab}`)}
          </button>
        ))}
      </div>

      {/* Unit toggle */}
      <div className="flex gap-2 mb-5">
        {['unit-a', 'unit-b'].map((uid) => (
          <button
            key={uid}
            onClick={() => setActiveUnit(uid)}
            className={`flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl border transition ${
              activeUnit === uid
                ? 'bg-coqui-600 text-white border-coqui-600'
                : 'bg-white text-coqui-800 border-cafe-200 hover:bg-cafe-50'
            }`}
          >
            {uid === 'unit-a' ? 'Unit A' : 'Unit B'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'recommendations' && (
        <AutopilotTab activeUnit={activeUnit} locale={locale} />
      )}
      {activeTab === 'competitors' && (
        <CompetitorsTab activeUnit={activeUnit} locale={locale} />
      )}
      {activeTab === 'research' && (
        <ResearchTab activeUnit={activeUnit} locale={locale} />
      )}
    </div>
  );
}
