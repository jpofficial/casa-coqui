'use client';

import { useState, useEffect, useContext, createContext, useCallback } from 'react';

const LocaleContext = createContext({ locale: 'es', setLocale: () => {} });

const STORAGE_KEY = 'casa-coqui-locale';

export function LocaleProvider({ defaultLocale = 'es', children }) {
  const [locale, setLocaleState] = useState(defaultLocale);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((newLocale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export default function useLocale() {
  return useContext(LocaleContext);
}
