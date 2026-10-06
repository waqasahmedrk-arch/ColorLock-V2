"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/components/I18nProvider";
import { LOCALE_COOKIE, htmlLang, type Locale } from "@/lib/i18n";

const OPTIONS: { locale: Locale; label: string; title: string }[] = [
  { locale: "en", label: "EN", title: "English" },
  { locale: "zh", label: "繁中", title: "繁體中文" },
];

// EN / 繁中 pill. The choice is a cookie so server-rendered pages come back in it too
// (and the API sends verification emails in it); refresh() re-renders in place.
export default function LanguageSwitcher() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale || pending) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = htmlLang(next);
    startTransition(() => router.refresh());
  }

  return (
    <div className="lang-switch" role="radiogroup" aria-label={t.header.language}
         data-locale={locale} data-pending={pending ? "" : undefined}>
      <span className="lang-switch-thumb" aria-hidden />
      {OPTIONS.map((o) => (
        <button key={o.locale} type="button" role="radio" aria-checked={o.locale === locale}
                title={o.title} lang={htmlLang(o.locale)} data-no-loader
                onClick={() => choose(o.locale)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
