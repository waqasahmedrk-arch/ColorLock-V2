import en, { type Dict } from "./en";
import zh from "./zh";

export type { Dict };
export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
// Shared with the API (it reads the same cookie to pick the email language).
export const LOCALE_COOKIE = "lang";

const DICTS: Record<Locale, Dict> = { en, zh };

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "zh";
}

export function getDictionary(locale: Locale): Dict {
  return DICTS[locale];
}

// BCP 47 tag for <html lang> and Intl formatting.
export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-TW" : "en";
}

// An API message in the current language, or unchanged if it has no translation.
export function translateServer(t: Dict, msg: string): string {
  return t.server[msg] ?? t.serverPattern(msg) ?? msg;
}

// Study data from the API: translated by id where the dictionary has it, else the API text.
export function dataText(map: Record<string, string>, id: string, fallback: string): string {
  return map[id] ?? fallback;
}
