# Running ColourLock locally (Windows)

Run everything from the repository root (`F:\htdocs\ColorLock-main`) in PowerShell.
You need **three things running**: MySQL, the API (backend) and the frontend. The admin panel is an
optional fourth: its own site on its own port.

---

## 1. Start MySQL (XAMPP) — for user accounts

Either open the **XAMPP Control Panel** and click **Start** next to MySQL, or in a new terminal:

```powershell
C:\xampp\mysql_start.bat
```

Keep that window open. First time only, create the accounts database:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS colourlock_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
```

---

## 2. Start the backend (API) — Terminal 1

```powershell
cd F:\htdocs\ColorLock-main
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # only if activation is blocked
.venv\Scripts\Activate.ps1
cd backend\api
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

- API docs: http://localhost:8000/api/v1/docs
- Health check: http://localhost:8000/api/v1/health → `{"status":"ok"}`

---

## 3. Start the frontend — Terminal 2

```powershell
cd F:\htdocs\ColorLock-main\frontend
npm run dev
```

- Open: http://localhost:3000 (you are redirected to `/login` first)

---

## Stopping

- API and frontend: press `Ctrl + C` in their terminals.
- MySQL: click **Stop** in the XAMPP Control Panel (or close the `mysql_start.bat` window).

---

## First-time setup (only once, on a fresh machine)

```powershell
cd F:\htdocs\ColorLock-main
Copy-Item .env.example .env
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e "packages/colourlock[dev]" -e "backend/api[dev,mysql]"
cd frontend
npm install
cd ..
```

---

## Admin panel — a separate site (Terminal 3)

The admin panel runs as its own site on **http://localhost:3001**, apart from the user site on :3000.
Same code, second dev server:

```powershell
cd F:\htdocs\ColorLock-main\frontend
npm run dev:admin
```

- Open: http://localhost:3001 (admin sign-in; admin accounts only, no sign-up)
- `/admin` on the user site redirects here; user pages opened here go back to :3000.
- **Separate sign-ins.** The admin panel has its own session (`cl_admin` cookie). Signing in or out
  on the user site never changes who is signed in on the admin panel, and the other way round.

**The first admin:** put the email in `.env` and restart the API. That account (made once on the user
site's sign-up page) becomes an admin the first time it signs in at :3001:

```
ADMIN_EMAILS=you@example.com
```

**Two-step sign-in.** Every admin sign-in is the password, then a 6-digit code emailed to the admin
(10-minute expiry, 5 tries, resend after 60 s). With `EMAIL_BACKEND=console` the code is printed in
the API terminal instead.

**More admins:** in the panel, **Admins → Add admin** creates an admin account (name, email, password).
It starts unverified; the code from its first sign-in at :3001 verifies the email. An existing user can be promoted from **Users → a user → Make admin**.

**API changes not showing up?** Stop the API with `Ctrl + C` and start it again. On Windows the
`--reload` worker can occasionally linger; if port 8000 still answers with old code, check Task Manager
for a leftover `python.exe` and end it.

**Different ports?** `npm run dev:admin -- -p 4001`, then in `frontend/.env.local` set
`NEXT_PUBLIC_ADMIN_URL=http://localhost:4001` (and `NEXT_PUBLIC_SITE_URL` if the user site moved),
and add the new origin to `FRONTEND_ORIGINS` in the root `.env`.

---

## Tips

- **Login codes not arriving by email?** In `.env` set `EMAIL_BACKEND=console` and restart the API;
  the codes are then printed in the API terminal.
- **Port already in use?** Use different ports:
  ```powershell
  python -m uvicorn app.main:app --reload --port 8001   # also set PUBLIC_BASE_URL in .env
  npm run dev -- -p 3001                                 # also set FRONTEND_ORIGINS in .env
  ```
