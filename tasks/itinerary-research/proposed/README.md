# Itinerary Proposals — Review Queue

Scout agents write daily activity proposals here. Julio reviews them, flips `approved: true` on the ones to keep, then runs `node scripts/merge-itinerary-proposals.js` to integrate approved entries into the live DynamoDB activities table.

## Workflow

```
┌──────────────────────────────────────┐
│ 1. Dispatch a scout agent            │
│    @itinerary-day-trips-scout        │
│    @itinerary-adrenaline-scout       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 2. Scout writes a proposal file      │
│    proposed/YYYY-MM-DD-<scout>.json  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 3. Julio reviews each entry          │
│    Edits voice/details if needed     │
│    Flips "approved": false → true    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 4. Run merge script                  │
│    node scripts/merge-itinerary-     │
│         proposals.js                 │
│    → appends approved → seed-final/  │
│    → reseeds DynamoDB                │
│    → moves processed file to         │
│      approved/ subfolder             │
└──────────────────────────────────────┘
```

## Proposal schema (v1)

Every proposal item must include these fields. The scout drafts everything; Julio edits or approves as-is.

### Required fields

| Field | Type | Notes |
|---|---|---|
| `approved` | boolean | Starts `false`. Julio flips to `true` for entries to merge. |
| `schema_version` | int | Currently `1`. Bump when shape changes; merge script handles backfill. |
| `confidence` | string | `"high"`, `"medium"`, or `"low"`. Reflects how recently the scout verified operator is open and accurate. Low = "verify before approving." |
| `name` | string | The activity name. Include operator + experience format, e.g., `"Skydive Puerto Rico — Tandem Jump (Humacao)"`. |
| `neighborhood` | string | City/region the activity is based in. |
| `type` | string | Specific category, e.g., `"Tandem skydive"`, `"Top-10 world beach day trip (ferry-required)"`. |
| `description` | string | 2-4 sentence concrete description of the experience. What you actually DO. |
| `why_it_matters` | string | 1-2 sentences explaining the DIFFERENTIATOR vs. other operators/places in the existing catalog. **Not generic tourism copy** — must answer "why this over the others?" |
| `source_urls` | string[] | Where the scout found the info. Required for verifiability. |

### Required-when-applicable fields

| Field | Type | When |
|---|---|---|
| `logistics_notes` | string | Required for any activity outside metro San Juan or requiring multi-step transport. Host-voice paragraph: drive time, parking cost, ferry booking URL, last-return-time. |
| `logistics_notes_no_car` | string | Required when getting back without a car is materially harder than getting there (e.g., Ceiba ferry trips, El Yunque north entrance). |

### Optional fields (defaults if omitted)

`hours`, `price_tier`, `admission_cost`, `best_for_persona`, `walkability_from_old_san_juan`, `kid_friendly`, `guided_tour_available`, `reservation_required`, `ideal_time_of_day`, `time_to_allocate_min`, `accessibility_notes`, `gear_needed`.

The scout fills these where it has high confidence. Julio fills the rest before approving.

## File format

```json
{
  "agent": "itinerary-day-trips-scout",
  "generated_at": "2026-05-13T20:00:00Z",
  "schema_version": 1,
  "count": 3,
  "items": [
    {
      "approved": false,
      "schema_version": 1,
      "confidence": "high",
      "name": "Cueva Ventana",
      ...
    }
  ]
}
```

## Hard rules every scout must follow

1. **Dedupe against `seed-final/*.json` AND `proposed/*.json` (all dates).** Don't re-propose what's already in the live DB or already in someone's queue.
2. **Geographic filter**: within ~2.5hr drive of San Juan. Casa Coqui's funnel requires SJ-area focus. NO Rincón / Aguadilla / Cabo Rojo / Isabela proposals.
3. **Atomic write**: write to a `.tmp` file first, rename to final filename only after successful completion. Prevents corrupted partial JSON on rate-limit interruption.
4. **Failure logging**: if you complete with 0 proposals (rate-limited, no good sources, etc.), write a log to `tasks/itinerary-research/failed/<date>-<scout>.json` explaining why. Silent zero-runs are bugs.
5. **`why_it_matters` differentiator rule**: any `why_it_matters` value that doesn't explain what makes THIS operator/place different from the existing catalog gets rejected at merge time. Generic praise ("amazing experience", "must-do") is not acceptable.

## After merge

The merge script moves processed proposal files into `proposed/approved/<date>-<scout>.json` (audit trail). Rejected entries stay in the original file with `approved: false`. The original file is moved to `proposed/archived/<date>-<scout>.json` after the merge run.

## Failure folder

`tasks/itinerary-research/failed/` holds error logs from scout runs that completed with zero output (rate-limit, no candidates found, etc.). Check here when a scout appears silent.
