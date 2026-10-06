import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import BackToTop from "@/components/BackToTop";
import ChatWidget from "@/components/ChatWidget";
import ClickLoader from "@/components/ClickLoader";
import HeaderScroll from "@/components/HeaderScroll";
import { I18nProvider } from "@/components/I18nProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import MobileNav from "@/components/MobileNav";
import NotificationBell from "@/components/NotificationBell";
import SiteFooter from "@/components/SiteFooter";
import ThemeToggle,{ THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import WaveNav from "@/components/WaveNav";
import WelcomeOverlay from "@/components/WelcomeOverlay";
import { IS_ADMIN_APP } from "@/lib/appMode";
import { htmlLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import "./globals.css";
import "@/components/chat.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: IS_ADMIN_APP ? t.meta.admin : t.meta.title, description: t.meta.description };
}

const BRAND = ["#4169E1", "#DC143C", "#228B22", "#DAA520"];

// Site typeface, self-hosted by next/font; exposed as --font-sans for globals.css.
const quicksand = Quicksand({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-sans",
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, { locale, t }] = await Promise.all([getSessionUser(), getT()]);
  // The admin site (lib/appMode.ts) keeps only the brand, language, theme and account menu;
  // its own sidebar does the navigating.
  const site = !IS_ADMIN_APP;
  return (
    <html lang={htmlLang(locale)} className={quicksand.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <I18nProvider locale={locale}>
        <Suspense fallback={null}>
          <ClickLoader />
        </Suspense>
        <HeaderScroll />
        <header className={site ? "site" : "site is-admin-site"}>
          <div className="shell">
            <Link href="/" className="brand">
              <span className="brand-dots" aria-hidden>
                {BRAND.map((c) => <i key={c} style={{ background: c }} />)}
              </span>
              ColorLock
              {!site && <span className="brand-admin">{t.admin.badge}</span>}
            </Link>
            {site && user && <WaveNav />}
            <LanguageSwitcher />
            <ThemeToggle />
            {site && user && <NotificationBell />}
            <UserMenu user={user} />
            {site && user && <MobileNav />}
          </div>
        </header>
        <main className="shell">{children}</main>
        <WelcomeOverlay user={user} />
        {site && <SiteFooter signedIn={!!user} />}
        <BackToTop />
        {/* Support chat for users; admins answer from the admin panel instead. */}
        {site && user && !user.is_admin && <ChatWidget user={user} />}
        </I18nProvider>
      </body>
    </html>
  );
}
