import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';

/**
 * POST /api/pricing/import
 *
 * Import Airbnb transaction history CSV data.
 * Expects JSON body with parsed CSV rows (client-side parsing).
 *
 * Body: {
 *   filename: "transactions.csv",
 *   unitMappings: { "Casa Coqui - Unit A": "unit-a", "Casa Coqui - Unit B": "unit-b" },
 *   rows: [
 *     { date: "2026-03-15", type: "Payout", amount: 245.00, confirmationCode: "HM...", listing: "Casa Coqui - Unit A", description: "..." },
 *   ]
 * }
 */
export async function POST(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  try {
    const body = await request.json();
    const { filename, unitMappings = {}, rows } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No rows to import' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Create import batch
    const batchResult = db.prepare(`
      INSERT INTO import_batches (source_type, filename, rows_parsed)
      VALUES ('airbnb_csv', ?, ?)
    `).run(filename || 'unknown.csv', rows.length);
    const batchId = batchResult.lastInsertRowid;

    let saved = 0;
    let skipped = 0;
    const errors = [];

    const insertTx = db.prepare(`
      INSERT INTO airbnb_transactions (confirmation_code, unit_id, transaction_type, transaction_date, amount, description, listing_name, import_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(confirmation_code, transaction_type, transaction_date) DO UPDATE SET
        amount = excluded.amount,
        description = excluded.description,
        import_batch_id = excluded.import_batch_id
    `);

    const insertRes = db.prepare(`
      INSERT INTO airbnb_reservations (confirmation_code, unit_id, check_in, check_out, nights, nightly_rate, total_payout, source, import_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_import', ?)
      ON CONFLICT(confirmation_code) DO UPDATE SET
        total_payout = COALESCE(excluded.total_payout, airbnb_reservations.total_payout),
        import_batch_id = excluded.import_batch_id
    `);

    db.transaction(() => {
      for (const row of rows) {
        try {
          // Validate required fields
          if (!row.confirmationCode || !row.date || row.amount == null) {
            skipped++;
            errors.push(`Row missing required fields: ${JSON.stringify(row).slice(0, 100)}`);
            continue;
          }

          // Map listing name to unit_id
          const unitId = unitMappings[row.listing] || guessUnitId(row.listing);
          if (!unitId) {
            skipped++;
            errors.push(`Could not map listing "${row.listing}" to a unit`);
            continue;
          }

          // Parse amount
          const amount = parseFloat(row.amount);
          if (isNaN(amount)) {
            skipped++;
            errors.push(`Invalid amount for ${row.confirmationCode}: ${row.amount}`);
            continue;
          }

          // Parse date
          const txDate = normalizeDate(row.date);
          if (!txDate) {
            skipped++;
            errors.push(`Invalid date for ${row.confirmationCode}: ${row.date}`);
            continue;
          }

          // Insert transaction
          const txType = normalizeTxType(row.type);
          insertTx.run(
            row.confirmationCode,
            unitId,
            txType,
            txDate,
            amount,
            row.description || null,
            row.listing || null,
            batchId
          );

          // If it's a payout, try to create/update a reservation record
          if (txType === 'payout' && amount > 0) {
            try {
              // Parse check-in/out from description if available
              const dates = parseDatesFromDescription(row.description);
              if (dates) {
                const nights = daysBetween(dates.checkIn, dates.checkOut);
                const nightlyRate = nights > 0 ? Math.round(amount / nights * 100) / 100 : null;
                insertRes.run(
                  row.confirmationCode,
                  unitId,
                  dates.checkIn,
                  dates.checkOut,
                  nights,
                  nightlyRate,
                  amount,
                  batchId
                );
              }
            } catch { /* reservation derivation is best-effort */ }
          }

          saved++;
        } catch (err) {
          skipped++;
          errors.push(`Error on ${row.confirmationCode}: ${err.message}`);
        }
      }
    })();

    // Update batch with results
    db.prepare(`
      UPDATE import_batches SET rows_saved = ?, rows_skipped = ?, errors = ?
      WHERE id = ?
    `).run(saved, skipped, errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null, batchId);

    return NextResponse.json({
      success: true,
      data: {
        batchId,
        rowsParsed: rows.length,
        rowsSaved: saved,
        rowsSkipped: skipped,
        errors: errors.slice(0, 10),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/pricing/import
 *
 * List import batches.
 */
export async function GET(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const db = getDb();

  const batches = db.prepare(`
    SELECT * FROM import_batches ORDER BY imported_at DESC LIMIT 20
  `).all();

  const stats = db.prepare(`
    SELECT unit_id,
           COUNT(*) as total_transactions,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_revenue,
           MIN(transaction_date) as earliest,
           MAX(transaction_date) as latest
    FROM airbnb_transactions
    GROUP BY unit_id
  `).all();

  return NextResponse.json({
    success: true,
    data: { batches, stats },
  });
}

// --- Helpers ---

function guessUnitId(listing) {
  if (!listing) return null;
  const lower = listing.toLowerCase();
  if (lower.includes('unit a') || lower.includes('unit-a') || lower.includes('apt a') || lower.includes('apartment a')) return 'unit-a';
  if (lower.includes('unit b') || lower.includes('unit-b') || lower.includes('apt b') || lower.includes('apartment b')) return 'unit-b';
  // Default: if only one unit mentioned or generic name, let user map
  return null;
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  // Handle common date formats: MM/DD/YYYY, YYYY-MM-DD, MM-DD-YYYY
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(dateStr)) return dateStr;

  const mdy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
  const match = dateStr.match(mdy);
  if (match) {
    const [, m, d, y] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try JS Date parse as fallback
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

function normalizeTxType(type) {
  if (!type) return 'payout';
  const lower = type.toLowerCase().trim();
  if (lower.includes('payout') || lower.includes('reservation')) return 'payout';
  if (lower.includes('adjust')) return 'adjustment';
  if (lower.includes('resolution') || lower.includes('refund')) return 'resolution';
  return 'payout';
}

function parseDatesFromDescription(desc) {
  if (!desc) return null;
  // Look for date patterns like "Mar 15 - Mar 18, 2026" or "2026-03-15 to 2026-03-18"
  const rangeIso = /(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/;
  const matchIso = desc.match(rangeIso);
  if (matchIso) {
    return { checkIn: matchIso[1], checkOut: matchIso[2] };
  }
  return null;
}

function daysBetween(d1, d2) {
  const a = new Date(d1 + 'T12:00:00');
  const b = new Date(d2 + 'T12:00:00');
  return Math.max(1, Math.round((b - a) / 86400000));
}
