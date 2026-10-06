"""Outgoing mail (Gmail SMTP, or the console in dev): one-time codes and sign-in alerts.

Every email shares one layout (`_layout`): table-based with inline styles so it renders the
same in Gmail, Outlook and Apple Mail, plus a plain-text part for clients that want it.
"""

from __future__ import annotations

import logging
import re
import smtplib
import ssl
from datetime import UTC, datetime
from email.message import EmailMessage
from html import escape

from ..errors import ProblemError
from ..settings import Settings

log = logging.getLogger("colourlock.mail")

# Email text per UI language; the `lang` cookie the frontend's language switch sets (or the
# account's saved language) picks one. Anything else falls back to English.
_TEXT: dict[str, dict[str, str]] = {
    "en": {
        "subject_signup": "Your ColorLock verification code",
        "subject_reset": "Your ColorLock password reset code",
        "intro_signup": "Use this code to verify your email and finish creating your "
                        "ColorLock account.",
        "intro_reset": "Use this code to reset your ColorLock password.",
        "subject_admin": "Your ColorLock admin sign-in code",
        "intro_admin": "Use this code to finish signing in to the ColorLock admin panel. "
                       "If you didn't just enter your password there, change it right away.",
        "title_code": "Your one-time code",
        "your_code": "Your code: {code}",
        "expires": "It expires in {ttl} minutes.",
        "footer": "The code expires in {ttl} minutes. If you didn't request it, you can "
                  "ignore this email.",
        "auto_footer": "This is an automated message from ColorLock. Please don't reply to it.",
        # Sign-in alerts
        "subject_alert_user": "New sign-in to your ColorLock account",
        "subject_alert_admin": "New sign-in to the ColorLock admin panel",
        "title_alert_user": "New sign-in to your account",
        "title_alert_admin": "New sign-in to the admin panel",
        "hello": "Hi {name},",
        "alert_intro_user": "Your ColorLock account was just signed in to. Here are the details:",
        "alert_intro_admin": "Your account was just used to sign in to the ColorLock admin "
                             "panel. Here are the details:",
        "when": "When",
        "device": "Device",
        "ip": "IP address",
        "where": "Signed in to",
        "where_user": "ColorLock",
        "where_admin": "ColorLock admin panel",
        "unknown_device": "Unknown device",
        "unknown_ip": "Unknown",
        "device_on": "{browser} on {os}",
        "was_you": "If this was you, there's nothing to do.",
        "not_you": "If you don't recognise this sign-in, reset your password now. That signs "
                   "out every device that's using your account.",
        "button": "Reset your password",
        "devices_link": "Review your signed-in devices",
        "alert_footer": "You're receiving this security email because someone signed in to "
                        "your ColorLock account. These alerts can't be turned off.",
        "time_fmt": "{day} {month} {year}, {hm} UTC",
        "months": "January February March April May June July August September October "
                  "November December",
    },
    "zh": {
        "subject_signup": "您的 ColorLock 驗證碼",
        "subject_reset": "您的 ColorLock 密碼重置驗證碼",
        "intro_signup": "請使用以下驗證碼驗證您的電子郵件，完成 ColorLock 帳戶註冊。",
        "intro_reset": "請使用以下驗證碼重置您的 ColorLock 密碼。",
        "subject_admin": "您的 ColorLock 管理後台登入驗證碼",
        "intro_admin": "請使用以下驗證碼完成 ColorLock 管理後台登入。如果您剛才沒有在管理後台輸入密碼，請立即變更密碼。",
        "title_code": "您的一次性驗證碼",
        "your_code": "您的驗證碼：{code}",
        "expires": "驗證碼 {ttl} 分鐘內有效。",
        "footer": "驗證碼 {ttl} 分鐘內有效。如果這不是您本人的操作，請忽略此郵件。",
        "auto_footer": "此郵件由 ColorLock 系統自動發送，請勿直接回覆。",
        "subject_alert_user": "您的 ColorLock 帳戶有新的登入",
        "subject_alert_admin": "ColorLock 管理後台有新的登入",
        "title_alert_user": "您的帳戶有新的登入",
        "title_alert_admin": "管理後台有新的登入",
        "hello": "{name}，您好：",
        "alert_intro_user": "您的 ColorLock 帳戶剛剛有人登入，詳細資料如下：",
        "alert_intro_admin": "您的帳戶剛剛登入了 ColorLock 管理後台，詳細資料如下：",
        "when": "時間",
        "device": "裝置",
        "ip": "IP 位址",
        "where": "登入位置",
        "where_user": "ColorLock",
        "where_admin": "ColorLock 管理後台",
        "unknown_device": "未知裝置",
        "unknown_ip": "未知",
        "device_on": "{os} 上的 {browser}",
        "was_you": "如果這是您本人的操作，無需採取任何行動。",
        "not_you": "如果您不認得這次登入，請立即重置密碼，所有正在使用您帳戶的裝置都會被登出。",
        "button": "重置密碼",
        "devices_link": "查看已登入的裝置",
        "alert_footer": "由於有人登入您的 ColorLock 帳戶，因此您收到這封安全通知郵件。此類通知無法關閉。",
        "time_fmt": "{year}年{month_n}月{day}日 {hm}（UTC）",
        "months": "",
    },
}
_BRAND = ["#4169E1", "#DC143C", "#228B22", "#DAA520"]
_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"


def _text(lang: str | None) -> dict[str, str]:
    return _TEXT.get(lang or "en", _TEXT["en"])


# ------------------------------------------------------------------ layout

def _layout(lang: str, preheader: str, title: str, body: str, footer: str,
            accent: str = "#4169E1") -> str:
    """The shared email frame: brand header, a card with a coloured top edge, and a footer.
    `body` and `footer` are trusted HTML built here; callers escape anything user-supplied."""
    # The brand mark: the site's 2x2 grid of colour squares, in its own fixed-size table so
    # the wordmark's line height can't stretch the squares.
    def sq(c: str) -> str:
        return (f'<td width="9" height="9" style="width:9px;height:9px;background:{c};border-radius:2px;'
                f'font-size:0;line-height:0">&nbsp;</td>')
    gap = '<td width="3" style="width:3px;font-size:0;line-height:0">&nbsp;</td>'
    dots = (f'<td valign="middle" style="vertical-align:middle;font-size:0;line-height:0">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
            f'<tr>{sq(_BRAND[0])}{gap}{sq(_BRAND[1])}</tr>'
            f'<tr><td height="3" colspan="3" style="height:3px;font-size:0;line-height:0">&nbsp;</td></tr>'
            f'<tr>{sq(_BRAND[2])}{gap}{sq(_BRAND[3])}</tr></table></td>')
    return f"""<!doctype html>
<html lang="{'zh-Hant' if lang == 'zh' else 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f1ed;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f1ed">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
    <tr><td style="padding:0 4px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>{dots}
        <td valign="middle" style="padding-left:9px;vertical-align:middle;font:700 16px {_FONT};color:#1b1b19;letter-spacing:-0.2px">ColorLock</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e3e1da;border-top:4px solid {accent};border-radius:14px;padding:30px 30px 26px;font:15px/1.6 {_FONT};color:#1b1b19">
      <h1 style="margin:0 0 14px;font:700 21px/1.3 {_FONT};color:#1b1b19">{escape(title)}</h1>
      {body}
    </td></tr>
    <tr><td style="padding:18px 8px 0;font:12px/1.6 {_FONT};color:#8a8983;text-align:center">
      {footer}<br>&copy; {datetime.now(UTC).year} ColorLock
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""


def _button(href: str, label: str, color: str = "#1b1b19") -> str:
    # A "bulletproof" button: a link inside a filled table cell, so Outlook keeps its shape.
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px">'
            f'<tr><td style="border-radius:10px;background:{color}">'
            f'<a href="{escape(href)}" style="display:inline-block;padding:12px 22px;font:600 15px {_FONT};'
            f'color:#ffffff;text-decoration:none;border-radius:10px">{escape(label)}</a>'
            f'</td></tr></table>')


# ------------------------------------------------------------------ delivery

def _configured(settings: Settings) -> bool:
    return bool(settings.smtp_user and settings.smtp_password)


def _deliver(settings: Settings, msg: EmailMessage) -> None:
    """Sends over SMTP; raises smtplib.SMTPException / OSError on failure."""
    msg["From"] = f"ColorLock <{settings.smtp_from or settings.smtp_user}>"
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(settings.smtp_user or "", settings.smtp_password or "")
        smtp.send_message(msg)


# ------------------------------------------------------------------ one-time codes

def _otp_html(text: dict[str, str], lang: str, purpose: str, code: str, ttl_min: int) -> str:
    digits = "".join(
        f'<td style="width:44px;height:54px;border:1px solid #e3e1da;border-radius:9px;'
        f'background:#fafaf8;font:600 26px {_MONO};text-align:center;color:#1b1b19">{d}</td>'
        f'<td style="width:6px;font-size:0">&nbsp;</td>' for d in code
    )
    body = (f'<p style="margin:0 0 18px">{escape(text["intro_" + purpose])}</p>'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">'
            f'<tr>{digits}</tr></table>'
            f'<p style="margin:0;font-size:13px;color:#6b6a64">{escape(text["footer"].format(ttl=ttl_min))}</p>')
    return _layout(lang, text["your_code"].format(code=code), text["title_code"], body,
                   escape(text["auto_footer"]))


def send_otp(settings: Settings, to: str, purpose: str, code: str, lang: str = "en") -> None:
    if settings.email_backend == "console":
        # Dev only: EMAIL_BACKEND=smtp never takes this branch.
        log.warning("EMAIL_BACKEND=console: %s code for %s is %s", purpose, to, code)
        return
    if not _configured(settings):
        log.error("EMAIL_BACKEND=smtp but SMTP_USER / SMTP_PASSWORD are not set")
        raise ProblemError(503, "Email is not configured",
                           "The server has no mail account set up, so it can't send your code. "
                           "Set SMTP_USER and SMTP_PASSWORD in .env.")
    lang = lang if lang in _TEXT else "en"
    text = _text(lang)
    ttl = settings.otp_ttl_minutes
    msg = EmailMessage()
    msg["Subject"] = text["subject_" + purpose]
    msg["To"] = to
    msg.set_content(f"{text['intro_' + purpose]}\n\n{text['your_code'].format(code=code)}"
                    f"\n\n{text['expires'].format(ttl=ttl)}")
    msg.add_alternative(_otp_html(text, lang, purpose, code, ttl), subtype="html")
    try:
        _deliver(settings, msg)
    except (smtplib.SMTPException, OSError) as exc:
        log.error("sending %s email failed: %s", purpose, type(exc).__name__)
        raise ProblemError(502, "Could not send email",
                           "The verification email could not be sent. Try again shortly.") from exc


# ------------------------------------------------------------------ sign-in alerts

def describe_device(user_agent: str | None, text: dict[str, str]) -> str:
    """'Chrome on Windows' from a user-agent string (same rules as frontend/lib/device.ts)."""
    ua = user_agent or ""
    browser = ("Edge" if re.search(r"Edg/", ua) else "Opera" if re.search(r"OPR/|Opera", ua)
               else "Firefox" if "Firefox/" in ua else "Chrome" if "Chrome/" in ua
               else "Safari" if "Safari/" in ua else None)
    os_ = ("Windows" if "Windows" in ua else "Android" if "Android" in ua
           else "iOS" if re.search(r"iPhone|iPad|iPod", ua) else "macOS" if re.search(r"Mac OS X|Macintosh", ua)
           else "Linux" if "Linux" in ua else None)
    if not browser or not os_:
        return text["unknown_device"]
    return text["device_on"].format(browser=browser, os=os_)


def _when(at: datetime, text: dict[str, str]) -> str:
    at = at.astimezone(UTC) if at.tzinfo else at.replace(tzinfo=UTC)
    months = text["months"].split()
    return text["time_fmt"].format(day=at.day, month=months[at.month - 1] if months else "",
                                   month_n=at.month, year=at.year, hm=at.strftime("%H:%M"))


def sign_in_alert(settings: Settings, *, name: str, scope: str, at: datetime,
                  user_agent: str | None, ip: str | None, lang: str | None) -> tuple[str, str, str]:
    """(subject, plain text, html) for a sign-in alert; `scope` is "user" or "admin"."""
    lang = lang if lang in _TEXT else "en"
    text = _text(lang)
    site = settings.admin_url if scope == "admin" else settings.site_url
    reset = f"{site.rstrip('/')}/forgot-password"
    devices = f"{settings.site_url.rstrip('/')}/settings"
    rows = [
        (text["when"], _when(at, text), False),
        (text["device"], describe_device(user_agent, text), False),
        (text["ip"], ip or text["unknown_ip"], True),
        (text["where"], text["where_" + scope], False),
    ]
    subject = text["subject_alert_" + scope]
    title = text["title_alert_" + scope]
    intro = text["alert_intro_" + scope]

    details = "".join(
        f'<tr><td style="padding:10px 14px;{"border-top:1px solid #ecebe6;" if i else ""}'
        f'font:600 13px {_FONT};color:#6b6a64;white-space:nowrap;vertical-align:top;width:1%">{escape(k)}</td>'
        f'<td style="padding:10px 14px;{"border-top:1px solid #ecebe6;" if i else ""}'
        f'font:{"500 13px " + _MONO if mono else "600 14px " + _FONT};color:#1b1b19;word-break:break-word">{escape(v)}</td></tr>'
        for i, (k, v, mono) in enumerate(rows)
    )
    body = (
        f'<p style="margin:0 0 6px">{escape(text["hello"].format(name=name))}</p>'
        f'<p style="margin:0 0 18px">{escape(intro)}</p>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:#fafaf8;border:1px solid #e3e1da;border-radius:10px;margin:0 0 20px">{details}</table>'
        f'<p style="margin:0 0 10px">{escape(text["was_you"])}</p>'
        f'<p style="margin:0 0 16px">{escape(text["not_you"])}</p>'
        f'{_button(reset, text["button"], "#b3361f")}'
        f'<p style="margin:14px 0 0;font-size:13px"><a href="{escape(devices)}" '
        f'style="color:#2f5bd3;text-decoration:underline">{escape(text["devices_link"])}</a></p>'
    )
    html = _layout(lang, f'{rows[0][1]} · {rows[1][1]}', title, body,
                   escape(text["alert_footer"]), accent="#DAA520")

    plain = "\n".join([
        text["hello"].format(name=name), "", intro, "",
        *(f"{k}: {v}" for k, v, _ in rows), "",
        text["was_you"], text["not_you"], "", f"{text['button']}: {reset}",
        f"{text['devices_link']}: {devices}", "", "--", text["alert_footer"],
    ])
    return subject, plain, html


def send_sign_in_alert(settings: Settings, to: str, *, name: str, scope: str, at: datetime,
                       user_agent: str | None, ip: str | None, lang: str | None) -> None:
    """Emails a sign-in alert. Never raises: it runs after the sign-in has succeeded, and a
    mail problem must not look like a failed sign-in."""
    try:
        subject, plain, html = sign_in_alert(settings, name=name, scope=scope, at=at,
                                             user_agent=user_agent, ip=ip, lang=lang)
        if settings.email_backend == "console":
            log.warning("EMAIL_BACKEND=console: %s sign-in alert for %s", scope, to)
            return
        if not _configured(settings):
            log.error("sign-in alert not sent: SMTP_USER / SMTP_PASSWORD are not set")
            return
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["To"] = to
        msg.set_content(plain)
        msg.add_alternative(html, subtype="html")
        _deliver(settings, msg)
    except Exception as exc:  # noqa: BLE001 - deliberately best-effort
        log.error("sending %s sign-in alert failed: %s", scope, type(exc).__name__)
