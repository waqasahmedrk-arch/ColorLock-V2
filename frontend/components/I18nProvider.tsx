"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, getDictionary, htmlLang, type Dict, type Locale } from "@/lib/i18n";

const I18nContext = createContext<Locale>(DEFAULT_LOCALE);

// The root layout resolves the locale on the server and hands it down; client components
// look their text up with useI18n() so both render the same language.
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

export function useI18n(): { locale: Locale; t: Dict; lang: string } {
  const locale = useContext(I18nContext);
  return { locale, t: getDictionary(locale), lang: htmlLang(locale) };
}
