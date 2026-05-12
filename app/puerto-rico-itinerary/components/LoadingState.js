'use client';

export default function LoadingState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cafe-50 px-7 text-center">
      <div className="mb-6 h-16 w-16 animate-pulse rounded-full bg-atardecer-200" />
      <h2 className="mb-2 font-display text-2xl font-bold text-coqui-900">
        Building your itinerary&hellip;
      </h2>
      <p className="text-sm text-cafe-700">
        Reading the activities, asking the AI, sequencing your days.
      </p>
      <p className="mt-1 font-mono text-xs text-cafe-600">~10 seconds</p>
    </div>
  );
}
