import { z } from 'zod';

// `time` accepts any natural-language label Bedrock produces (e.g. "morning",
// "sunset", "brunch"). ActivityCard maps known labels to clock times and
// renders unknowns verbatim.
export const ItemSchema = z.object({
  activity_id: z.string().min(1),
  time: z.string().min(1),
  duration_min: z.number().int().positive(),
  note: z.string().optional(),
});

export const DaySchema = z.object({
  day_num: z.number().int().positive(),
  theme: z.string().min(1),
  items: z.array(ItemSchema).min(1).max(8),
});

export const ItinerarySchema = z.object({
  plan_id: z.string(),
  num_days: z.number().int().min(1).max(14).optional(),
  days: z.array(DaySchema).min(1),
});
