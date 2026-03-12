import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// Extracts an Amazon ASIN from a product URL.
// Handles URLs like:
//   https://www.amazon.com/dp/B08XYZ1234
//   https://www.amazon.com/product-name/dp/B08XYZ1234/ref=...
// Returns the ASIN string or null.
// ---------------------------------------------------------------------------
function extractAsin(url) {
  if (!url) return null;
  const match = url.match(/\/dp\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// GET /api/supplies/reorder
// Finds all low-stock supplies with autoReorder enabled and builds an Amazon
// cart URL for quick purchasing.
//
// Low stock criteria: quantity <= minimum AND autoReorder === true AND amazonUrl is set.
//
// Returns:
//   { success: true, data: { items: [...], cartUrl: "..." } }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const snapshot = await adminDb
      .collection('supplies')
      .where('autoReorder', '==', true)
      .get();

    // Filter in JS — Firestore can't do <= comparisons across two different fields
    const lowStockItems = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => item.quantity <= item.minimum && item.amazonUrl);

    if (lowStockItems.length === 0) {
      return NextResponse.json({
        success: true,
        data: { items: [], cartUrl: null },
      });
    }

    // Build Amazon cart URL from extracted ASINs
    const asinParams = [];
    const noAsinItems = [];
    let asinIndex = 1;

    for (const item of lowStockItems) {
      const asin = extractAsin(item.amazonUrl);
      if (asin) {
        asinParams.push(`ASIN.${asinIndex}=${encodeURIComponent(asin)}&Quantity.${asinIndex}=1`);
        asinIndex++;
      } else {
        noAsinItems.push(item.name);
      }
    }

    let cartUrl = null;
    if (asinParams.length > 0) {
      cartUrl = `https://www.amazon.com/gp/aws/cart/add.html?${asinParams.join('&')}`;
    }

    return NextResponse.json({
      success: true,
      data: {
        items: lowStockItems,
        cartUrl,
        noAsinItems,
      },
    });
  } catch (error) {
    console.error('[GET /api/supplies/reorder]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate reorder list.' },
      { status: 500 }
    );
  }
}
