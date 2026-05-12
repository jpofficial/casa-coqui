import { z } from 'zod';

export const ItemSchema = z.object({
  activity_id: z.string().min(1),
  time: z.enum(['early_morning', 'breakfast', 'morning', 'lunch', 'afternoon', 'evening', 'late_night', 'night']),
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
