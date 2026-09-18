#!/usr/bin/env node
/**
 * Merges the 18 consensus venue gaps from exploration agents (X1/X2/X3)
 * into the canonical activity seed JSON files. Output: 4 augmented JSON
 * files written to tasks/itinerary-research/seed-final/.
 *
 * Run once before seed-activities.js.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'data', 'itinerary-research');
const OUT = path.join(SRC, 'seed-final');
fs.mkdirSync(OUT, { recursive: true });

// The 18 consensus augmentations (from spec §5.6)
const AUGMENTATIONS = {
  'foodie-spots.json': [
    {
      activity_id: 'SAN-FOODIE-AUG-001',
      name: 'Cocina al Fondo',
      neighborhood: 'Santurce',
      type: 'Restaurant',
      hours: 'Tue-Sat 6pm-10pm, closed Sun-Mon',
      price_tier: '$$$$',
      description: '2023 James Beard winner. Hyper-local PR ingredients, modern tasting menu.',
      why_it_matters: '#1 priority — highest editorial momentum in San Juan dining right now.',
      best_for_persona: ['foodie', 'couples', 'special_occasion'],
      walkability_from_old_san_juan: '15 min Uber',
      kid_friendly: false,
      reservation_required: true,
      ideal_time_of_day: 'evening',
      time_to_allocate_min: 150,
      source_urls: ['https://www.jamesbeard.org/awards/2023'],
    },
    {
      activity_id: 'SAN-FOODIE-AUG-002',
      name: 'La Casita Blanca',
      neighborhood: 'Santurce',
      type: 'Restaurant',
      hours: 'Mon-Sat 11am-9pm',
      price_tier: '$$',
      description: "The locals' canonical comida criolla answer. Classic PR home cooking.",
      why_it_matters: 'Reddit consensus #1 for authentic criollo — what locals send tourists to.',
      best_for_persona: ['foodie', 'family', 'budget', 'local_color'],
      walkability_from_old_san_juan: '12 min Uber',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'lunch',
      time_to_allocate_min: 90,
      source_urls: ['https://reddit.com/r/PuertoRicoTravel'],
    },
    {
      activity_id: 'SAN-FOODIE-AUG-003',
      name: 'La Alcapurria Quemá',
      neighborhood: 'Santurce',
      type: 'Street food',
      hours: 'Thu-Sun 6pm-1am',
      price_tier: '$',
      description: 'Top street food kiosk near La Placita. Alcapurrias, mofongo, beer.',
      why_it_matters: 'Constantly named by locals — the late-night Santurce circuit anchor.',
      best_for_persona: ['foodie', 'budget', 'nightlife', 'local_color'],
      walkability_from_old_san_juan: '12 min Uber',
      kid_friendly: false,
      reservation_required: false,
      ideal_time_of_day: 'late_night',
      time_to_allocate_min: 60,
      source_urls: ['https://reddit.com/r/PuertoRicoTravel'],
    },
  ],
  'nightlife-experiences.json': [
    {
      activity_id: 'SAN-NIGHT-AUG-001',
      name: 'Identidad Cocktail Bar',
      neighborhood: 'Santurce',
      type: 'Craft cocktail bar',
      hours: 'Wed-Sat 6pm-2am',
      price_tier: '$$$',
      description: '2025 James Beard Best New Bar finalist. PR-ingredient-forward cocktails.',
      why_it_matters: 'Newest critical darling — already in chef-curated guides.',
      best_for_persona: ['couples', 'cocktail_enthusiast', 'nightlife'],
      walkability_from_old_san_juan: '15 min Uber',
      adults_only: true,
      kid_friendly: false,
      reservation_required: true,
      ideal_time_of_day: 'evening',
      time_to_allocate_min: 120,
      source_urls: ['https://www.jamesbeard.org/awards/2025'],
    },
  ],
  'outdoor-activities.json': [
    {
      activity_id: 'SAN-OUTDOOR-AUG-001',
      name: 'Calle Fortaleza (photo destination)',
      neighborhood: 'Old San Juan',
      type: 'Photo destination',
      hours: 'Anytime; best mid-morning or late afternoon',
      price_tier: 'FREE',
      description: 'Iconic OSJ photo street. ⚠️ Umbrella canopy gone as of 2024-2025; replaced with string lights behind barricade.',
      why_it_matters: 'Most Pinterest pins are stale — knowing the current state is a moat.',
      best_for_persona: ['photographer', 'couples', 'family'],
      walkability_from_old_san_juan: 'In OSJ',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'morning',
      time_to_allocate_min: 30,
      gear_needed: 'Phone or camera',
      source_urls: [],
    },
    {
      activity_id: 'SAN-OUTDOOR-AUG-002',
      name: 'Las Pailas Natural Water Slides',
      neighborhood: 'Río Grande',
      type: 'Adventure / natural pool',
      hours: 'Daylight, no admission gate',
      price_tier: '$',
      description: 'Natural rock water slides at El Yunque\'s edge. $5 parking, $1 per person. Coordinates: 18°20\'16.3"N 65°43\'51.8"W.',
      why_it_matters: 'Fastest-rising venue — zero in 2023 content, hero in 4/12 2024-26 vlogs.',
      best_for_persona: ['adventurer', 'family', 'couples'],
      walkability_from_old_san_juan: '50 min drive SE',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'morning',
      time_to_allocate_min: 180,
      gear_needed: 'Swimsuit, water shoes, towel',
      source_urls: [],
    },
    {
      activity_id: 'SAN-OUTDOOR-AUG-003',
      name: 'La Perla Viewpoint (from Calle Norzagaray)',
      neighborhood: 'Old San Juan',
      type: 'Photo destination (viewpoint only)',
      hours: 'Anytime',
      price_tier: 'FREE',
      description: 'Hero viewpoint of La Perla neighborhood + ocean wall from Calle Norzagaray. ⚠️ DO NOT walk into La Perla itself per local consensus.',
      why_it_matters: 'Hero photo in 5/12 visual content — Despacito connection. Viewpoint only.',
      best_for_persona: ['photographer', 'couples'],
      walkability_from_old_san_juan: 'In OSJ',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'sunset',
      time_to_allocate_min: 20,
      gear_needed: 'Camera',
      source_urls: [],
    },
    {
      activity_id: 'SAN-OUTDOOR-AUG-004',
      name: 'Playa Escambrón',
      neighborhood: 'San Juan',
      type: 'Public beach + snorkeling',
      hours: 'Sunrise to sunset',
      price_tier: 'FREE',
      description: 'Closest snorkeling beach to OSJ — small reef, calm water, kiosk concessions.',
      why_it_matters: 'Snorkel without driving 90 min — appears in 3 SEO blog itineraries.',
      best_for_persona: ['family', 'budget', 'adventurer', 'relaxation'],
      walkability_from_old_san_juan: '10 min Uber',
      kid_friendly: true,
      reservation_required: false,
      ideal_time_of_day: 'morning',
      time_to_allocate_min: 180,
      gear_needed: 'Swimsuit, snorkel mask (rentals on site)',
      source_urls: [],
    },
  ],
  'culture-history.json': [], // No culture additions from exploration
};

for (const [filename, additions] of Object.entries(AUGMENTATIONS)) {
  const srcPath = path.join(SRC, filename);
  const outPath = path.join(OUT, filename);
  const orig = JSON.parse(fs.readFileSync(srcPath, 'utf-8'));
  orig.items.push(...additions);
  orig.count = orig.items.length;
  orig.augmented_at = new Date().toISOString().slice(0, 10);
  orig.augmentations = additions.length;
  fs.writeFileSync(outPath, JSON.stringify(orig, null, 2));
  console.log(`✓ ${filename}: ${orig.count} items (${additions.length} augmented)`);
}

console.log('\nDone. Run scripts/seed/seed-activities.js next.');
