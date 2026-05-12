'use client';

export default function WizardStep({
  stepNumber,
  totalSteps,
  question,
  helper,
  options,
  multiSelect = true,
  selected,
  onToggle,
}) {
  return (
    <div className="mx-auto max-w-md px-7 pt-12 pb-32 md:max-w-xl lg:max-w-2xl lg:pt-20 lg:pb-40">
      {/* Progress */}
      <div className="mb-12 flex items-center justify-between lg:mb-16">
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
      {helper && (
        <p className="mb-8 text-center text-sm text-cafe-700 lg:text-base lg:mb-12">{helper}</p>
      )}

      <div className="flex flex-wrap justify-center gap-2.5 lg:gap-3">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value, multiSelect)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-all lg:px-5 lg:py-3 lg:text-base ${
                isSelected
                  ? 'border-coqui-500 bg-coqui-500 text-white'
                  : 'border-cafe-200 bg-cafe-100 text-coqui-900 hover:bg-cafe-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
