import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// ---------------------------------------------------------------------------
// GET /api/receipts/[month]
// Returns all receipts for a given month (format: YYYY-MM).
//
// Returns:
//   { success: true, data: [...receipts] }
// ---------------------------------------------------------------------------
export async function GET(request, { params }) {
  try {
    const { month } = params;

    // Validate YYYY-MM format
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month parameter must be in YYYY-MM format.' },
        { status: 400 }
      );
    }

    const snapshot = await adminDb
      .collection('receipts')
      .where('month', '==', month)
      .orderBy('uploadedAt', 'desc')
      .get();

    const receipts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ success: true, data: receipts });
  } catch (error) {
    console.error('[GET /api/receipts/[month]]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch receipts.' },
      { status: 500 }
    );
  }
}
