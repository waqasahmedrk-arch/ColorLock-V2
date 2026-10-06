"""Configure Gmail for sending sign-up / password-reset codes.

Asks for the Gmail address and App Password (input hidden), checks them against
smtp.gmail.com, sends a test email to that address, then writes them into the repo-root
.env. Nothing is printed or logged. Restart the API afterwards: it reads .env at start-up.

    .venv\\Scripts\\python.exe scripts\\setup_gmail.py
"""

from __future__ import annotations

import getpass
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path

ENV = Path(__file__).resolve().parents[1] / ".env"
HOST, PORT = "smtp.gmail.com", 587


def set_env(values: dict[str, str]) -> None:
    lines = ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []
    seen = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in values:
            lines[i] = f"{key}={values[key]}"
            seen.add(key)
    lines += [f"{k}={v}" for k, v in values.items() if k not in seen]
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    print("Gmail setup for ColourLock verification codes.\n"
          "Needs 2-Step Verification on, and an App Password from\n"
          "https://myaccount.google.com/apppasswords (your normal password won't work).\n")
    user = input("Gmail address: ").strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", user):
        print("That doesn't look like an email address.")
        return 1
    password = getpass.getpass("App Password (16 letters, hidden): ").replace(" ", "")
    if len(password) != 16:
        print(f"App Passwords are 16 letters; got {len(password)}. Copy it again from Google.")
        return 1

    print("Checking with Gmail...")
    msg = EmailMessage()
    msg["Subject"] = "ColourLock email is set up"
    msg["From"] = f"ColourLock <{user}>"
    msg["To"] = user
    msg.set_content("ColourLock can now send verification codes from this address.")
    try:
        with smtplib.SMTP(HOST, PORT, timeout=20) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(user, password)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        print("Gmail rejected the login. Use an App Password (not your account password), "
              "and check 2-Step Verification is on.")
        return 1
    except (smtplib.SMTPException, OSError) as exc:
        print(f"Could not reach Gmail ({type(exc).__name__}). Check your internet connection "
              "or firewall (port 587).")
        return 1

    set_env({"EMAIL_BACKEND": "smtp", "SMTP_HOST": HOST, "SMTP_PORT": str(PORT),
             "SMTP_USER": user, "SMTP_PASSWORD": password, "SMTP_FROM": user})
    print(f"OK: test email sent to {user}, and .env updated.\n"
          "Now restart the API so it picks up the new settings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
