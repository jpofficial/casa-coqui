import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

const VALID_CATEGORIES = ['Utilities', 'Cleaning', 'Repairs', 'Supplies', 'Insurance', 'Other'];
const DEFAULT_VALID_UNITS = ['Unit A', 'Unit B', 'Shared'];

async function getValidUnits() {
  try {
    const settingsDoc = await adminDb.collection('settings').doc('property').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : null;
    if (settings?.units && Array.isArray(settings.units) && settings.units.length > 0) {
      return [...settings.units.map((u) => u.name), 'Shared'];
    }
  } catch (err) {
    console.error('Failed to fetch unit settings:', err);
  }
  return DEFAULT_VALID_UNITS;
}

// ---------------------------------------------------------------------------
// GET /api/expenses
// Returns all expenses. Supports optional ?month=YYYY-MM filter.
//
// Returns:
//   { success: true, data: [...expenses] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    let query = adminDb.collection('expenses').orderBy('date', 'desc');

    if (month) {
      // Filter by YYYY-MM prefix on the date field
      const start = `${month}-01`;
      const end = `${month}-32`;
      query = query.where('date', '>=', start).where('date', '<=', end);
    }

    const snapshot = await query.get();
    const expenses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ success: true, data: expenses });
  } catch (error) {
    console.error('[GET /api/expenses]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch expenses.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/expenses
// Creates a new expense entry.
//
// Request body:
//   { amount, description, category, date, unit }
//
// Returns:
//   { success: true, data: { id, ...expense } }  — HTTP 201
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { amount, description, category, date, unit } = body;

    if (!amount || !description || !category || !date || !unit) {
      return NextResponse.json(
        { success: false, error: 'amount, description, category, date, and unit are required.' },
        { status: 400 }
      );
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount must be a positive number.' },
        { status: 400 }
      );
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { success: false, error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.` },
        { status: 400 }
      );
    }

    const validUnits = await getValidUnits();
    if (!validUnits.includes(unit)) {
      return NextResponse.json(
        { success: false, error: `unit must be one of: ${validUnits.join(', ')}.` },
        { status: 400 }
      );
    }

    // Derive month as YYYY-MM for easy querying
    const month = date.substring(0, 7);

    const expense = {
      amount: parsedAmount,
      description: String(description).trim(),
      category,
      date,
      month,
      unit,
      createdAt: new Date().toISOString(),
    };

    const docRef = await adminDb.collection('expenses').add(expense);

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...expense } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/expenses]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create expense.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/expenses
// Deletes a single expense by ID.
//
// Request body:
//   { id }
//
// Returns:
//   { success: true }
// ---------------------------------------------------------------------------
export async function DELETE(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required.' },
        { status: 400 }
      );
    }

    await adminDb.collection('expenses').doc(id).delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/expenses]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete expense.' },
      { status: 500 }
    );
  }
}
