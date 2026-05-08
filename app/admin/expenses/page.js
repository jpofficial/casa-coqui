'use client';

import { useState, useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { getUnitsWithShared } from '@/lib/units';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const CATEGORIES = ['Utilities', 'Cleaning', 'Repairs', 'Supplies', 'Insurance', 'Other'];

const CATEGORY_COLORS = {
  Utilities: '#6366f1',
  Cleaning: '#06b6d4',
  Repairs: '#f59e0b',
  Supplies: '#10b981',
  Insurance: '#8b5cf6',
  Other: '#94a3b8',
};

function todayISO() {
  return new Date().toISOString().split('T')[0];
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

export default function Expenses() {
  const { data: expenses, loading, error } = useCollection('expenses', [orderBy('date', 'desc')]);
  const { data: settings } = useDocument('settings', 'property');
  const UNITS = getUnitsWithShared(settings);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthYM());
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    amount: '',
    description: '',
    category: 'Supplies',
    date: todayISO(),
    unit: 'Shared',
  });

  // Filter by selected month
  const monthExpenses = useMemo(() => {
    return expenses.filter((e) => e.date && e.date.startsWith(selectedMonth));
  }, [expenses, selectedMonth]);

  // Filter by selected category on top of month filter
  const filteredExpenses = useMemo(() => {
    if (selectedCategory === 'All') return monthExpenses;
    return monthExpenses.filter((e) => e.category === selectedCategory);
  }, [monthExpenses, selectedCategory]);

  // Running total for the selected month (all categories)
  const monthTotal = useMemo(() => {
    return monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [monthExpenses]);

  // Category breakdown for chart
  const categoryData = useMemo(() => {
    const totals = {};
    for (const cat of CATEGORIES) {
      totals[cat] = 0;
    }
    for (const e of monthExpenses) {
      if (totals[e.category] !== undefined) {
        totals[e.category] += e.amount || 0;
      }
    }
    return CATEGORIES.map((cat) => ({ name: cat, amount: totals[cat] })).filter(
      (d) => d.amount > 0
    );
  }, [monthExpenses]);

  // Build list of available months from data
  const availableMonths = useMemo(() => {
    const months = new Set();
    months.add(currentMonthYM());
    for (const e of expenses) {
      if (e.date) months.add(e.date.substring(0, 7));
    }
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const amount = parseFloat(form.amount);
    if (!form.description.trim()) {
      setFormError('Description is required.');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setFormError('Please enter a valid positive amount.');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        amount,
        description: form.description.trim(),
        category: form.category,
        date: form.date,
        month: form.date.substring(0, 7),
        unit: form.unit,
        createdAt: new Date().toISOString(),
      });
      setForm({ amount: '', description: '', category: 'Supplies', date: todayISO(), unit: 'Shared' });
      setShowForm(false);
      // Switch to the month we just added to
      setSelectedMonth(form.date.substring(0, 7));
    } catch (err) {
      console.error(err);
      setFormError('Failed to save expense. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (err) {
      console.error('Failed to delete expense:', err);
    } finally {
      setDeleteTarget(null);
    }
  }

  if (error) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto">
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
          Failed to load expenses. Please refresh.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track property spending by category</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-2.5 text-sm flex-shrink-0"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add Expense Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">New Expense</h2>
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
                placeholder="e.g. LUMA Electric Bill"
                className={INPUT_CLASS}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  name="category"
                  value={form.category}
                  onChange={handleFormChange}
                  className={INPUT_CLASS}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
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
            </div>

            {formError && (
              <p className="text-xs text-red-600">{formError}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-3 text-sm disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Expense'}
            </button>
          </form>
        </div>
      )}

      {/* Month Picker */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-3">
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

        {/* Monthly Total */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-gray-500">Total for {formatMonthLabel(selectedMonth)}</span>
          <span className="text-xl font-bold text-gray-900">{formatCurrency(monthTotal)}</span>
        </div>
      </div>

      {/* Category Breakdown Chart */}
      {!loading && categoryData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">By Category</h2>
          <ResponsiveContainer width="100%" height={categoryData.length * 44 + 20}>
            <BarChart
              data={categoryData}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tickFormatter={(v) => `$${v}`}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={72}
                tick={{ fontSize: 12, fill: '#374151' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(value), 'Total']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                {categoryData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={CATEGORY_COLORS[entry.name] || '#94a3b8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Category Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {['All', ...CATEGORIES].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedCategory === cat
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-600 active:bg-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Expense List */}
      <div className="space-y-2">
        {loading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-100 rounded w-1/3" />
                <div className="h-4 bg-gray-100 rounded w-16" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-1/2 mt-2" />
            </div>
          ))
        ) : filteredExpenses.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <p className="text-gray-400 text-sm">
              No expenses for {formatMonthLabel(selectedMonth)}
              {selectedCategory !== 'All' ? ` in ${selectedCategory}` : ''}.
            </p>
          </div>
        ) : (
          filteredExpenses.map((expense) => (
            <div key={expense.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {expense.description}
                    </span>
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[expense.category]}22`,
                        color: CATEGORY_COLORS[expense.category] || '#6b7280',
                      }}
                    >
                      {expense.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {expense.date} &middot; {expense.unit}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-gray-900">
                    {formatCurrency(expense.amount)}
                  </span>
                  <button
                    onClick={() => setDeleteTarget(expense.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                    aria-label="Delete expense"
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

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-bold text-gray-900 mb-1">Delete Expense?</h3>
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
