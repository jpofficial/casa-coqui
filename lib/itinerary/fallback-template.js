/**
 * Returned when Bedrock or the Lambda is unavailable.
 * Hand-crafted "5 days in San Juan" using canonical seed activities.
 *
 * activity_id derivation (FILENAME-NNN = 1-based position in seed JSON items array):
 *   CULTURE-HISTORY-001  → culture-history.json item 1  (El Morro)
 *   FOODIE-SPOTS-006     → foodie-spots.json item 6      (Café Cuatro Sombras)
 *   FOODIE-SPOTS-002     → foodie-spots.json item 2      (Pirilo Pizza Rústica)
 *   NIGHTLIFE-EXPERIENCES-001 → nightlife-experiences.json item 1 (La Factoría)
 *   OUTDOOR-ACTIVITIES-006   → outdoor-activities.json item 6 (La Mina Falls)
 *   OUTDOOR-ACTIVITIES-013   → outdoor-activities.json item 13 (Luquillo Beach)
 *   OUTDOOR-ACTIVITIES-001   → outdoor-activities.json item 1  (Condado Beach)
 *   OUTDOOR-ACTIVITIES-004   → outdoor-activities.json item 4  (Piñones Beach)
 *   CULTURE-HISTORY-006      → culture-history.json item 6     (MAPR)
 *   SAN-FOODIE-AUG-002       → foodie-spots.json augmented     (La Casita Blanca)
 *   SAN-FOODIE-AUG-003       → foodie-spots.json augmented     (La Alcapurria Quemá)
 *   OUTDOOR-ACTIVITIES-009   → outdoor-activities.json item 9  (Laguna Grande bio bay)
 */
export const FALLBACK_PLAN = {
  is_fallback: true,
  num_days: 5,
  days: [
    {
      day_num: 1,
      theme: 'Old San Juan',
      items: [
        {
          activity_id: 'CULTURE-HISTORY-001',
          time: 'morning',
          duration_min: 120,
          note: 'El Morro — start early before cruise crowds.',
        },
        {
          activity_id: 'FOODIE-SPOTS-006',
          time: 'afternoon',
          duration_min: 60,
          note: 'Café Cuatro Sombras for single-estate PR coffee.',
        },
        {
          activity_id: 'FOODIE-SPOTS-002',
          time: 'evening',
          duration_min: 90,
          note: 'Pirilo Pizza Rústica — wood-fired, locals love it.',
        },
        {
          activity_id: 'NIGHTLIFE-EXPERIENCES-001',
          time: 'late_night',
          duration_min: 120,
          note: "La Factoría — World's 50 Best Bars.",
        },
      ],
    },
    {
      day_num: 2,
      theme: 'El Yunque + Luquillo',
      items: [
        {
          activity_id: 'OUTDOOR-ACTIVITIES-006',
          time: 'morning',
          duration_min: 240,
          note: 'La Mina Falls hike — get there by 9am for parking.',
        },
        {
          activity_id: 'OUTDOOR-ACTIVITIES-013',
          time: 'afternoon',
          duration_min: 180,
          note: 'Late lunch + beach time at Luquillo kiosks.',
        },
      ],
    },
    {
      day_num: 3,
      theme: 'Beach day + Piñones',
      items: [
        {
          activity_id: 'OUTDOOR-ACTIVITIES-001',
          time: 'morning',
          duration_min: 180,
          note: 'Beach morning — Condado, calm water and easy access.',
        },
        {
          activity_id: 'OUTDOOR-ACTIVITIES-004',
          time: 'afternoon',
          duration_min: 180,
          note: 'Drive to Piñones for kiosk frituras + ocean bike path.',
        },
      ],
    },
    {
      day_num: 4,
      theme: 'Santurce culture + nightlife',
      items: [
        {
          activity_id: 'CULTURE-HISTORY-006',
          time: 'afternoon',
          duration_min: 180,
          note: "MAPR — Puerto Rico's premier fine arts museum.",
        },
        {
          activity_id: 'SAN-FOODIE-AUG-002',
          time: 'evening',
          duration_min: 90,
          note: 'La Casita Blanca — comida criolla, Reddit consensus #1.',
        },
        {
          activity_id: 'SAN-FOODIE-AUG-003',
          time: 'late_night',
          duration_min: 60,
          note: 'La Alcapurria Quemá — late-night street food near La Placita.',
        },
      ],
    },
    {
      day_num: 5,
      theme: 'Slow morning + Fajardo bio bay',
      items: [
        {
          activity_id: 'FOODIE-SPOTS-006',
          time: 'morning',
          duration_min: 90,
          note: 'Slow morning coffee in OSJ at Café Cuatro Sombras.',
        },
        {
          activity_id: 'OUTDOOR-ACTIVITIES-009',
          time: 'evening',
          duration_min: 180,
          note: 'Laguna Grande bio bay kayak tour — book in advance.',
        },
      ],
    },
  ],
};
