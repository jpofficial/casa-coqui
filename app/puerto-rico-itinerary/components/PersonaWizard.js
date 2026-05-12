'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import WizardStep from './WizardStep';
import LoadingState from './LoadingState';

const STEPS = [
  {
    question: "What&apos;s your travel vibe?",
    helper: "Pick all that apply. We&apos;ll match activities to your taste.",
    multiSelect: true,
    field: 'interests',
    options: [
      { value: 'foodie', label: '🍴 Foodie' },
      { value: 'family', label: '👨‍👩‍👧 Family' },
      { value: 'beach', label: '🌊 Beach + Sun' },
      { value: 'history', label: '🏛 History buff' },
      { value: 'nightlife', label: '🎶 Nightlife' },
      { value: 'outdoor', label: '🥾 Outdoor' },
      { value: 'romantic', label: '💑 Romantic' },
      { value: 'art', label: '🎨 Art & culture' },
      { value: 'budget', label: '💸 Budget-conscious' },
      { value: 'cocktails', label: '🍹 Cocktail enthusiast' },
    ],
  },
  {
    question: 'How many days?',
    helper: 'How long is your San Juan trip?',
    multiSelect: false,
    field: 'num_days',
    options: [
      { value: '3', label: '3 days' },
      { value: '4', label: '4 days' },
      { value: '5', label: '5 days' },
      { value: '6', label: '6 days' },
      { value: '7', label: '7 days' },
      { value: '10', label: '10+ days' },
    ],
  },
  {
    question: 'Who are you traveling with?',
    helper: 'This shapes the recommendations.',
    multiSelect: false,
    field: 'traveler_type',
    options: [
      { value: 'couple', label: '💑 Couple' },
      { value: 'family', label: '👨‍👩‍👧 Family with kids' },
      { value: 'friends', label: '👯 Friends group' },
      { value: 'solo', label: '🧍 Solo' },
    ],
  },
  {
    question: 'Any pace preference?',
    helper: 'Optional — leave blank if no preference.',
    multiSelect: false,
    field: 'pace',
    options: [
      { value: 'packed', label: '⚡ Packed — see everything' },
      { value: 'balanced', label: '🌿 Balanced' },
      { value: 'slow', label: '🌅 Slow — savor it' },
    ],
  },
];

export default function PersonaWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useState({
    interests: [],
    num_days: null,
    traveler_type: null,
    pace: null,
  });

  const current = STEPS[step];

  const handleToggle = (value, multi) => {
    setAnswers((prev) => {
      const existing = prev[current.field];
      if (multi) {
        const arr = Array.isArray(existing) ? existing : [];
        return {
          ...prev,
          [current.field]: arr.includes(value)
            ? arr.filter((v) => v !== value)
            : [...arr, value],
        };
      }
      return { ...prev, [current.field]: value };
    });
  };

  const canContinue = () => {
    const v = answers[current.field];
    if (current.multiSelect) return Array.isArray(v) && v.length > 0;
    return v !== null && v !== undefined;
  };

  const handleContinue = async () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...answers,
          num_days: Number(answers.num_days),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${res.status})`);
      }
      const { plan_id } = await res.json();
      router.push(`/puerto-rico-itinerary/${plan_id}`);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  if (loading) return <LoadingState />;

  const selectedForCurrent = current.multiSelect
    ? answers[current.field] || []
    : answers[current.field]
    ? [answers[current.field]]
    : [];

  return (
    <div className="relative min-h-screen bg-cafe-50">
      <WizardStep
        stepNumber={step + 1}
        totalSteps={STEPS.length}
        question={current.question}
        helper={current.helper}
        options={current.options}
        multiSelect={current.multiSelect}
        selected={selectedForCurrent}
        onToggle={handleToggle}
      />

      {error && (
        <p className="mx-auto max-w-md px-7 text-center text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-cafe-50 via-cafe-50/95 to-transparent px-7 pb-7 pt-12">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue()}
          className="w-full rounded-2xl bg-coqui-500 px-8 py-4 font-semibold text-white shadow-[0_6px_14px_-3px_rgba(26,154,90,0.4)] disabled:bg-cafe-300 disabled:text-cafe-600 disabled:shadow-none"
        >
          {step < STEPS.length - 1 ? 'Continue →' : 'Build my itinerary →'}
        </button>
      </div>
    </div>
  );
}
