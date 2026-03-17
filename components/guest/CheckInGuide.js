'use client';

import { useState } from 'react';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// Fallback steps used when no settings are loaded
function getFallbackSteps(locale) {
  return [
    { title: t(locale, 'guide_step1'), description: t(locale, 'guide_step1Desc') },
    { title: t(locale, 'guide_step2'), description: t(locale, 'guide_step2Desc') },
    { title: t(locale, 'guide_step3'), description: t(locale, 'guide_step3Desc') },
    { title: t(locale, 'guide_step4'), description: t(locale, 'guide_step4Desc') },
    { title: t(locale, 'guide_step5'), description: t(locale, 'guide_step5Desc') },
  ];
}

const STEP_ICONS = [
  // Map pin
  <svg key="pin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>,
  // Lock
  <svg key="lock" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>,
  // Home
  <svg key="home" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>,
  // Key
  <svg key="key" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
  </svg>,
  // Thumbs up
  <svg key="thumbs" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
  </svg>,
];

function GuideStep({ step, index, isOpen, onToggle }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
        aria-expanded={isOpen}
      >
        {/* Step number badge */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white text-sm font-bold flex items-center justify-center">
          {index + 1}
        </div>

        {/* Step icon + title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-green-700">
            <span className="flex-shrink-0">{STEP_ICONS[index % STEP_ICONS.length]}</span>
            <span className="font-semibold text-sm text-gray-900 truncate">{step.title}</span>
          </div>
          {!isOpen && step.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{step.description}</p>
          )}
        </div>

        {/* Chevron */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="px-4 pb-4 border-t border-gray-50">
          {step.description && (
            <p className="text-sm text-gray-600 mt-3 leading-relaxed whitespace-pre-line">{step.description}</p>
          )}

          {step.imageUrl && (
            <img
              src={step.imageUrl}
              alt={step.title}
              className="mt-3 w-full rounded-lg object-cover max-h-48"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function CheckInGuide({ settings }) {
  const { locale } = useLocale();
  const steps = settings?.checkInSteps?.length ? settings.checkInSteps : getFallbackSteps(locale);
  const [openStep, setOpenStep] = useState(0);

  function toggle(index) {
    setOpenStep((prev) => (prev === index ? null : index));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-gray-900">{t(locale, 'guide_title')}</h2>
        <button
          onClick={() => setOpenStep(openStep === null ? 0 : null)}
          className="text-xs text-green-600 font-medium hover:underline"
        >
          {openStep === null ? t(locale, 'guide_expandAll') : t(locale, 'guide_collapse')}
        </button>
      </div>

      {/* Address callout */}
      {settings?.address && (
        <div className="flex gap-2.5 items-start bg-green-50 border border-green-100 rounded-xl p-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          <p className="text-sm text-green-800 font-medium">{settings.address}</p>
        </div>
      )}

      {/* Progress pill */}
      <div className="flex gap-1" role="progressbar" aria-label="Steps overview">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-1 rounded-full transition-colors ${
              i === openStep ? 'bg-green-600' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-2 mt-1">
        {steps.map((step, i) => (
          <GuideStep
            key={i}
            step={step}
            index={i}
            isOpen={openStep === i}
            onToggle={() => toggle(i)}
          />
        ))}
      </div>

      {/* Help note */}
      <p className="text-xs text-center text-gray-400 mt-2">
        {t(locale, 'guide_somethingWrong')}{' '}
        <a
          href="maintenance"
          className="text-green-600 font-medium underline underline-offset-2"
        >
          {t(locale, 'guide_submitMaintenance')}
        </a>
      </p>
    </div>
  );
}
