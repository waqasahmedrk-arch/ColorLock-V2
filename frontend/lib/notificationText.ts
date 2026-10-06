// Turns a stored notification (kind + data) into text in the reader's language, plus the icon
// the bell and the Notifications page show next to it.

import type { IconName } from "@/components/Icon";
import { fmt } from "@/lib/api";
import { describeDevice } from "@/lib/device";
import type { Dict } from "@/lib/i18n";
import type { AppNotification } from "@/lib/notifications";

export interface NotificationView {
  icon: IconName;
  title: string;
  body: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function viewOf(n: AppNotification, t: Dict): NotificationView {
  const k = t.notifications.kinds;
  const d = n.data;
  switch (n.kind) {
    case "welcome":
      return { icon: "sparkles", ...k.welcome(str(d.name) ?? "") };
    case "new_sign_in": {
      const dev = describeDevice(str(d.user_agent));
      const device = dev ? t.notifications.on(dev.browser, dev.os) : t.notifications.unknownDevice;
      return { icon: "logIn", ...k.newSignIn(device, str(d.ip)) };
    }
    case "password_changed":
      return { icon: "key", ...k.passwordChanged(num(d.signed_out)) };
    case "password_reset":
      return { icon: "key", ...k.passwordReset() };
    case "sessions_revoked":
      return { icon: "logOut", ...(d.by_admin ? k.sessionsRevokedByAdmin(num(d.count)) : k.sessionsRevoked(num(d.count))) };
    case "admin_message":
      return { icon: "message", ...k.adminMessage(str(d.admin) ?? "", str(d.preview) ?? "", d.image === true) };
    case "account_restored":
      return { icon: "unlock", ...k.accountRestored() };
    case "history_cleared":
      return { icon: "trash", ...k.historyCleared(num(d.count)) };
    case "personal_best":
      return { icon: "trophy", ...k.personalBest(fmt(num(d.delta_e00), 2), fmt(num(d.previous), 2), str(d.name) ?? str(d.filename)) };
    case "milestone":
      return { icon: "flag", ...k.milestone(num(d.count)) };
    default:
      return { icon: "bell", ...k.unknown() };
  }
}

// "5 minutes ago", "yesterday" ... in the reader's language.
export function relativeTime(iso: string, lang: string, justNow: string): string {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Math.abs(secs) < 60) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400],
    ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return justNow;
}
