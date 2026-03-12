import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

const VALID_UNITS = ['Unit A', 'Unit B'];

// ---------------------------------------------------------------------------
// GET /api/revenue
// Returns all revenue entries. Supports optional ?year=YYYY filter.
//
// Returns:
//   { success: true, data: [...revenue] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    let query = adminDb.collection('revenue').orderBy('date', 'desc');

    if (year) {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      query = query.where('date', '>=', start).where('date', '<=', end);
    }

    const snapshot = await query.get();
    const revenue = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ success: true, data: revenue });
  } catch (error) {
    console.error('[GET /api/revenue]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch revenue entries.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/revenue
// Creates a new revenue entry.
//
// Request body:
//   { amount, description, unit, date, bookingId? }
//
// Returns:
//   { success: true, data: { id, ...entry } }  — HTTP 201
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { amount, description, unit, date, bookingId } = body;

    if (!amount || !date) {
      return NextResponse.json(
        { success: false, error: 'amount and date are required.' },
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

    if (unit && !VALID_UNITS.includes(unit)) {
      return NextResponse.json(
        { success: false, error: `unit must be one of: ${VALID_UNITS.join(', ')}.` },
        { status: 400 }
      );
    }

    // Derive month and year for easy aggregation
    const month = date.substring(0, 7);
    const year = date.substring(0, 4);

    const entry = {
      amount: parsedAmount,
      description: description ? String(description).trim() : '',
      unit: unit || 'Unit A',
      date,
      month,
      year,
      bookingId: bookingId || null,
      createdAt: new Date().toISOString(),
    };

    const docRef = await adminDb.collection('revenue').add(entry);

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...entry } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/revenue]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create revenue entry.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/revenue
// Deletes a revenue entry by ID.
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

    await adminDb.collection('revenue').doc(id).delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/revenue]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete revenue entry.' },
      { status: 500 }
    );
  }
}
