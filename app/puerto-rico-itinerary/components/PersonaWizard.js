'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import WizardStep from './WizardStep';
import LoadingState from './LoadingState';

const STEPS = [
  {
    question: "What's your travel vibe?",
    helper: "Pick all that apply. We'll match activities to your taste.",
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
  {
    freeText: true,
    field: 'special_requests',
    question: 'Tell us about you',
    helper:
      "The more we know, the better we tailor. Say it like you'd tell a friend — interests, vibe, what you avoid, what you're celebrating. Optional, you can skip.",
    placeholder:
      'e.g. "Love hiking and being in nature. Not into big crowds. Vegetarian. First time in PR — want a mix of must-sees and hidden spots."',
    examples: [
      '🥾 Love nature & walking',
      '🌅 First-time visitor',
      '🌴 Want hidden gems',
      '🎉 Not into nightlife',
      '🥗 Vegetarian',
      '🥃 Rum tasting',
      '🕺 Want to dance salsa',
      '📸 Mostly photography',
      '👨‍👩‍👧 Traveling with kids',
      '🎯 Celebrating anniversary',
      '🎂 Celebrating birthday',
      '♿ Need ADA-accessible options',
      '💼 Solo / digital nomad',
      '❌ Avoid tourist traps',
      '🌊 Beach lover',
      '🌃 Big nightlife fan',
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
    special_requests: '',
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

  const handleFreeText = (value) => {
    setAnswers((prev) => ({ ...prev, [current.field]: value }));
  };

  const handleExampleClick = (text) => {
    setAnswers((prev) => {
      const existing = prev[current.field] || '';
      const cleaned = text.replace(/^[^\s]+ /, ''); // strip emoji prefix
      const next = existing.trim() ? `${existing.trim()}. ${cleaned}` : cleaned;
      return { ...prev, [current.field]: next };
    });
  };

  const canContinue = () => {
    if (current.freeText) return true; // optional step
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
          special_requests: (answers.special_requests || '').trim() || undefined,
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
      {current.freeText ? (
        <FreeTextStep
          stepNumber={step + 1}
          totalSteps={STEPS.length}
          question={current.question}
          helper={current.helper}
          placeholder={current.placeholder}
          examples={current.examples}
          value={answers[current.field] || ''}
          onChange={handleFreeText}
          onExampleClick={handleExampleClick}
        />
      ) : (
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
      )}

      {error && (
        <p className="mx-auto max-w-md px-7 text-center text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-cafe-50 via-cafe-50/95 to-transparent px-7 pb-7 pt-12">
        <div className="mx-auto max-w-md md:max-w-xl lg:max-w-2xl">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue()}
            className="w-full rounded-2xl border-2 border-coqui-500 bg-coqui-500 px-8 py-4 font-semibold text-white shadow-[0_6px_14px_-3px_rgba(26,154,90,0.4)] transition-colors disabled:border-coqui-200 disabled:bg-white disabled:text-coqui-400 disabled:shadow-none lg:py-5 lg:text-lg"
          >
            {canContinue()
              ? step < STEPS.length - 1
                ? 'Continue →'
                : 'Build my itinerary →'
              : current.multiSelect
              ? 'Pick at least one to continue'
              : 'Choose one to continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FreeTextStep({ stepNumber, totalSteps, question, helper, placeholder, examples, value, onChange, onExampleClick }) {
  return (
    <div className="mx-auto max-w-md px-7 pt-12 pb-40 md:max-w-xl lg:max-w-2xl lg:pt-20 lg:pb-48">
      <div className="mb-12 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-700">
          Step {stepNumber} of {totalSteps}
        </span>
        <div className="mx-3 h-1 flex-1 overflow-hidden rounded-full bg-cafe-200">
          <div
            className="h-full rounded-full bg-atardecer-300 transition-all duration-300"
            style={{ width: `${(stepNumber / totalSteps) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-caribe-700">
          {Math.round((stepNumber / totalSteps) * 100)}%
        </span>
      </div>

      <h2 className="mb-2 text-center font-display text-3xl font-bold leading-tight text-coqui-900 lg:text-5xl lg:mb-4">
        {question}
      </h2>
      <p className="mb-6 text-center text-sm text-cafe-700 lg:text-base lg:mb-8">{helper}</p>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 500))}
        placeholder={placeholder}
        rows={4}
        maxLength={500}
        className="mb-1 w-full rounded-2xl border border-cafe-200 bg-white px-4 py-3 text-sm leading-relaxed text-coqui-900 placeholder:text-cafe-500 focus:border-coqui-500 focus:outline-none focus:ring-2 focus:ring-coqui-500/20 lg:px-5 lg:py-4 lg:text-base"
      />
      <p className="mb-4 text-right font-mono text-[10px] text-cafe-500 lg:mb-6">
        {value.length}/500
      </p>

      <p className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-cafe-600">
        Or tap to add
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onExampleClick(ex)}
            className="rounded-full border border-cafe-200 bg-cafe-100 px-3 py-1.5 text-xs text-coqui-900 hover:bg-cafe-200"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
