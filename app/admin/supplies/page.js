'use client';

import { useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection } from '@/hooks/useFirestore';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent';

function isLowStock(supply) {
  return supply.quantity <= supply.minimum;
}

function QuantityControl({ supply }) {
  const [updating, setUpdating] = useState(false);

  async function changeQty(delta) {
    const newQty = Math.max(0, (supply.quantity || 0) + delta);
    setUpdating(true);
    try {
      await updateDoc(doc(db, 'supplies', supply.id), {
        quantity: newQty,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to update quantity:', err);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => changeQty(-1)}
        disabled={updating || supply.quantity <= 0}
        className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold text-lg flex items-center justify-center active:bg-gray-200 disabled:opacity-40 transition-colors"
        aria-label="Decrease quantity"
      >
        -
      </button>
      <span className={`w-8 text-center text-sm font-bold ${isLowStock(supply) ? 'text-red-600' : 'text-gray-900'}`}>
        {supply.quantity}
      </span>
      <button
        onClick={() => changeQty(1)}
        disabled={updating}
        className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold text-lg flex items-center justify-center active:bg-gray-200 disabled:opacity-40 transition-colors"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

function AutoReorderToggle({ supply }) {
  async function toggle() {
    try {
      await updateDoc(doc(db, 'supplies', supply.id), {
        autoReorder: !supply.autoReorder,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to toggle auto-reorder:', err);
    }
  }

  return (
    <button
      onClick={toggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        supply.autoReorder ? 'bg-green-500' : 'bg-gray-300'
      }`}
      aria-label="Toggle auto-reorder"
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          supply.autoReorder ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
        style={{ transform: supply.autoReorder ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

function EditSupplyModal({ supply, onClose }) {
  const [form, setForm] = useState({
    name: supply.name || '',
    quantity: String(supply.quantity ?? ''),
    minimum: String(supply.minimum ?? ''),
    amazonUrl: supply.amazonUrl || '',
    autoReorder: supply.autoReorder || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    const qty = Number(form.quantity);
    const min = Number(form.minimum);
    if (isNaN(qty) || qty < 0) {
      setError('Quantity must be a non-negative number.');
      return;
    }
    if (isNaN(min) || min < 0) {
      setError('Minimum must be a non-negative number.');
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'supplies', supply.id), {
        name: form.name.trim(),
        quantity: qty,
        minimum: min,
        amazonUrl: form.amazonUrl.trim(),
        autoReorder: form.autoReorder,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
        <h3 className="text-base font-bold text-gray-900 mb-4">Edit Supply</h3>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input type="text" name="name" value={form.name} onChange={handleChange} className={INPUT_CLASS} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
              <input type="number" name="quantity" value={form.quantity} onChange={handleChange} min="0" className={INPUT_CLASS} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Minimum</label>
              <input type="number" name="minimum" value={form.minimum} onChange={handleChange} min="0" className={INPUT_CLASS} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amazon URL</label>
            <input type="url" name="amazonUrl" value={form.amazonUrl} onChange={handleChange} placeholder="https://amazon.com/dp/..." className={INPUT_CLASS} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="autoReorder" checked={form.autoReorder} onChange={handleChange} className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500" />
            <span className="text-sm text-gray-700">Auto-reorder when low</span>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-lg px-4 py-3 text-sm active:bg-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg px-4 py-3 text-sm disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Supplies() {
  const { data: supplies, loading, error } = useCollection('supplies', [orderBy('name', 'asc')]);

  const [showForm, setShowForm] = useState(false);
  const [editSupply, setEditSupply] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [reorderResult, setReorderResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    name: '',
    quantity: '',
    minimum: '',
    amazonUrl: '',
    autoReorder: false,
  });

  const lowStockCount = supplies.filter(isLowStock).length;

  function handleFormChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  async function handleAddSupply(e) {
    e.preventDefault();
    setFormError('');

    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    const qty = Number(form.quantity);
    if (isNaN(qty) || qty < 0) {
      setFormError('Quantity must be a non-negative number.');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'supplies'), {
        name: form.name.trim(),
        quantity: qty,
        minimum: Number(form.minimum) || 0,
        amazonUrl: form.amazonUrl.trim(),
        autoReorder: form.autoReorder,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setForm({ name: '', quantity: '', minimum: '', amazonUrl: '', autoReorder: false });
      setShowForm(false);
    } catch (err) {
      console.error(err);
      setFormError('Failed to add supply. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'supplies', id));
    } catch (err) {
      console.error('Failed to delete supply:', err);
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleReorder() {
    setReorderLoading(true);
    setReorderResult(null);
    try {
      const res = await fetch('/api/supplies/reorder');
      const json = await res.json();
      if (json.success) {
        setReorderResult(json.data);
        if (json.data.cartUrl) {
          window.open(json.data.cartUrl, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setReorderLoading(false);
    }
  }

  if (error) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto">
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
          Failed to load supplies. Please refresh.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Supplies</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Inventory &amp; auto-reorder
            {lowStockCount > 0 && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                {lowStockCount} low
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-2.5 text-sm flex-shrink-0"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Reorder Banner */}
      {!loading && lowStockCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {lowStockCount} item{lowStockCount > 1 ? 's' : ''} low on stock
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Tap to generate Amazon reorder cart
            </p>
          </div>
          <button
            onClick={handleReorder}
            disabled={reorderLoading}
            className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg px-4 py-2.5 text-sm flex-shrink-0 disabled:opacity-50"
          >
            {reorderLoading ? 'Loading...' : 'Reorder'}
          </button>
        </div>
      )}

      {/* Reorder Result */}
      {reorderResult && reorderResult.items.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
          No items currently need reordering.
        </div>
      )}

      {/* Add Supply Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">New Supply</h2>
          <form onSubmit={handleAddSupply} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleFormChange}
                placeholder="e.g. Paper Towels"
                className={INPUT_CLASS}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
                <input
                  type="number"
                  name="quantity"
                  value={form.quantity}
                  onChange={handleFormChange}
                  min="0"
                  placeholder="0"
                  className={INPUT_CLASS}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Minimum</label>
                <input
                  type="number"
                  name="minimum"
                  value={form.minimum}
                  onChange={handleFormChange}
                  min="0"
                  placeholder="2"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amazon URL</label>
              <input
                type="url"
                name="amazonUrl"
                value={form.amazonUrl}
                onChange={handleFormChange}
                placeholder="https://amazon.com/dp/..."
                className={INPUT_CLASS}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="autoReorder"
                checked={form.autoReorder}
                onChange={handleFormChange}
                className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-sm text-gray-700">Auto-reorder when low</span>
            </label>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-3 text-sm disabled:opacity-50"
            >
              {submitting ? 'Adding...' : 'Add Supply'}
            </button>
          </form>
        </div>
      )}

      {/* Supply List */}
      <div className="space-y-2">
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-100 rounded w-1/3" />
                <div className="h-4 bg-gray-100 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-1/4 mt-2" />
            </div>
          ))
        ) : supplies.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <p className="text-gray-400 text-sm">No supplies yet.</p>
            <button
              onClick={() => setShowForm(true)}
              className="text-green-600 text-sm font-medium mt-1"
            >
              Add your first supply
            </button>
          </div>
        ) : (
          supplies.map((supply) => {
            const low = isLowStock(supply);
            return (
              <div
                key={supply.id}
                className={`rounded-xl shadow-sm p-4 border transition-colors ${
                  low
                    ? 'bg-red-50 border-red-200'
                    : 'bg-white border-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${low ? 'text-red-800' : 'text-gray-900'}`}>
                        {supply.name}
                      </span>
                      {low && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                          Low
                        </span>
                      )}
                      {supply.autoReorder && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-600">
                          Auto
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Min: {supply.minimum}
                      {supply.amazonUrl && (
                        <span>
                          {' '}
                          &middot;{' '}
                          <a
                            href={supply.amazonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 underline"
                          >
                            Amazon
                          </a>
                        </span>
                      )}
                    </p>
                  </div>

                  <QuantityControl supply={supply} />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Auto-reorder</span>
                    <AutoReorderToggle supply={supply} />
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditSupply(supply)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      aria-label="Edit supply"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setDeleteTarget(supply.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      aria-label="Delete supply"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit Modal */}
      {editSupply && (
        <EditSupplyModal supply={editSupply} onClose={() => setEditSupply(null)} />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-bold text-gray-900 mb-1">Delete Supply?</h3>
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
