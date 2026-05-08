'use client';

import { useState, useMemo } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { getUnitNames } from '@/lib/units';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// Color palette for unit chips and charts — cycles for additional units
const UNIT_COLOR_PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#ef4444'];

function getUnitColor(unit, unitNames) {
  const idx = unitNames.indexOf(unit);
  return UNIT_COLOR_PALETTE[idx >= 0 ? idx % UNIT_COLOR_PALETTE.length : 0];
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function currentYear() {
  return String(new Date().getFullYear());
}

function currentMonthYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(ym) {
  if (!ym) return '';
  const [year, month] = ym.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatCurrency(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent';

function SummaryCard({ label, value, accent, loading }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500 font-medium leading-none">{label}</span>
      {loading ? (
        <div className="h-6 w-20 bg-gray-100 rounded animate-pulse mt-1" />
      ) : (
        <span className={`text-xl font-bold leading-tight mt-1 ${accent || 'text-gray-900'}`}>
          {value}
        </span>
      )}
    </div>
  );
}

export default function Revenue() {
  const { data: allRevenue, loading, error } = useCollection('revenue', [orderBy('date', 'desc')]);
  const { data: bookings } = useCollection('bookings', [where('status', '==', 'active')]);
  const { data: settings } = useDocument('settings', 'property');
  const UNITS = getUnitNames(settings);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthYM());
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    amount: '',
    description: '',
    unit: UNITS[0] || 'Unit A',
    date: todayISO(),
    bookingId: '',
  });

  // Monthly revenue for selected month
  const monthRevenue = useMemo(() => {
    return allRevenue.filter((r) => r.date && r.date.startsWith(selectedMonth));
  }, [allRevenue, selectedMonth]);

  // Yearly revenue
  const yearRevenue = useMemo(() => {
    return allRevenue.filter((r) => r.date && r.date.startsWith(selectedYear));
  }, [allRevenue, selectedYear]);

  // Totals
  const monthTotal = useMemo(() => monthRevenue.reduce((s, r) => s + (r.amount || 0), 0), [monthRevenue]);
  const yearTotal = useMemo(() => yearRevenue.reduce((s, r) => s + (r.amount || 0), 0), [yearRevenue]);

  // Per-unit monthly totals — keyed by unit name
  const unitMonthTotals = useMemo(() => {
    const totals = {};
    for (const u of UNITS) {
      totals[u] = monthRevenue.filter((r) => r.unit === u).reduce((s, r) => s + (r.amount || 0), 0);
    }
    return totals;
  }, [monthRevenue, UNITS]);

  // Monthly chart data for selected year — one key per unit
  const monthlyChartData = useMemo(() => {
    return MONTHS_SHORT.map((label, idx) => {
      const monthStr = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
      const row = { label };
      let total = 0;
      for (const u of UNITS) {
        const val = yearRevenue
          .filter((r) => r.date && r.date.startsWith(monthStr) && r.unit === u)
          .reduce((s, r) => s + (r.amount || 0), 0);
        row[u] = val;
        total += val;
      }
      row.total = total;
      return row;
    });
  }, [yearRevenue, selectedYear, UNITS]);

  // Available months for filter
  const availableMonths = useMemo(() => {
    const months = new Set([currentMonthYM()]);
    for (const r of allRevenue) {
      if (r.date) months.add(r.date.substring(0, 7));
    }
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [allRevenue]);

  // Available years for chart
  const availableYears = useMemo(() => {
    const years = new Set([currentYear()]);
    for (const r of allRevenue) {
      if (r.date) years.add(r.date.substring(0, 4));
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [allRevenue]);

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setFormError('Please enter a valid positive amount.');
      return;
    }
    if (!form.date) {
      setFormError('Date is required.');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'revenue'), {
        amount,
        description: form.description.trim(),
        unit: form.unit,
        date: form.date,
        month: form.date.substring(0, 7),
        year: form.date.substring(0, 4),
        bookingId: form.bookingId || null,
        createdAt: new Date().toISOString(),
      });
      setForm({ amount: '', description: '', unit: UNITS[0] || 'Unit A', date: todayISO(), bookingId: '' });
      setShowForm(false);
      setSelectedMonth(form.date.substring(0, 7));
      setSelectedYear(form.date.substring(0, 4));
    } catch (err) {
      console.error(err);
      setFormError('Failed to save revenue entry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'revenue', id));
    } catch (err) {
      console.error('Failed to delete revenue entry:', err);
    } finally {
      setDeleteTarget(null);
    }
  }

  if (error) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto">
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
          Failed to load revenue data. Please refresh.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Revenue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Income by unit and month</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-2.5 text-sm flex-shrink-0"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add Revenue Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">New Revenue Entry</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleFormChange}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className={INPUT_CLASS}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input
                  type="date"
                  name="date"
                  value={form.date}
                  onChange={handleFormChange}
                  className={INPUT_CLASS}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input
                type="text"
                name="description"
                value={form.description}
                onChange={handleFormChange}
                placeholder="e.g. Airbnb booking payout"
                className={INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                <select
                  name="unit"
                  value={form.unit}
                  onChange={handleFormChange}
                  className={INPUT_CLASS}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Booking (optional)</label>
                <select
                  name="bookingId"
                  value={form.bookingId}
                  onChange={handleFormChange}
                  className={INPUT_CLASS}
                >
                  <option value="">None</option>
                  {bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.guestName || b.unit} · {b.checkInDate}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-3 text-sm disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Entry'}
            </button>
          </form>
        </div>
      )}

      {/* Month Picker */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs font-medium text-gray-600 flex-shrink-0">Month</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className={INPUT_CLASS}
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard
            label={`${formatMonthLabel(selectedMonth)} Total`}
            value={formatCurrency(monthTotal)}
            accent="text-green-600"
            loading={loading}
          />
          <SummaryCard
            label={`${selectedYear} Total`}
            value={formatCurrency(yearTotal)}
            accent="text-green-600"
            loading={loading}
          />
          {UNITS.map((u, idx) => (
            <SummaryCard
              key={u}
              label={u}
              value={formatCurrency(unitMonthTotals[u] || 0)}
              accent={idx === 0 ? 'text-emerald-600' : 'text-indigo-600'}
              loading={loading}
            />
          ))}
        </div>
      </div>

      {/* Yearly Bar Chart */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Monthly Revenue</h2>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-3">
          {UNITS.map((unit) => (
            <div key={unit} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getUnitColor(unit, UNITS) }} />
              <span className="text-xs text-gray-500">{unit}</span>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
            />
            <Tooltip
              formatter={(value, name) => [formatCurrency(value), name]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
            {UNITS.map((u, idx) => (
              <Bar
                key={u}
                dataKey={u}
                stackId="a"
                fill={getUnitColor(u, UNITS)}
                radius={idx === UNITS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue List */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {formatMonthLabel(selectedMonth)}
        </h2>

        <div className="space-y-2">
          {loading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="flex justify-between">
                  <div className="h-4 bg-gray-100 rounded w-1/3" />
                  <div className="h-4 bg-gray-100 rounded w-16" />
                </div>
                <div className="h-3 bg-gray-100 rounded w-1/4 mt-2" />
              </div>
            ))
          ) : monthRevenue.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <p className="text-gray-400 text-sm">
                No revenue for {formatMonthLabel(selectedMonth)}.
              </p>
            </div>
          ) : (
            monthRevenue.map((entry) => (
              <div key={entry.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {entry.description || 'Revenue'}
                      </span>
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${getUnitColor(entry.unit, UNITS)}22`,
                          color: getUnitColor(entry.unit, UNITS),
                        }}
                      >
                        {entry.unit}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{entry.date}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold text-green-600">
                      {formatCurrency(entry.amount)}
                    </span>
                    <button
                      onClick={() => setDeleteTarget(entry.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                      aria-label="Delete revenue entry"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-bold text-gray-900 mb-1">Delete Entry?</h3>
            <p className="text-sm text-gray-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-lg px-4 py-3 text-sm active:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-3 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
