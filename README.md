# Support Triage MVP

Rule-based Gmail triage backend with Google OAuth.

## Setup in 5 Minutes (Windows PowerShell)
1. Prerequisites
   - Node.js 20+ (`node -v`)
   - npm (bundled with Node)
   - Google Cloud OAuth credentials for a Web application

2. Create Google OAuth credentials
   - In Google Cloud Console, create/select a project.
   - Enable Gmail API.
   - Create OAuth Client ID (Web application).
   - Add redirect URI: `http://localhost:3000/oauth2callback`
   - Download credentials JSON and place it at `backend/credentials.json`.
   - `backend/credentials.json` must stay untracked and never be committed.

3. Configure environment
   - Copy `backend/.env.example` to `backend/.env`
   - Fill required values in `backend/.env`

4. Install and run
```powershell
cd backend
npm install
npm run dev:safe
```

5. Complete OAuth
   - Open `http://localhost:3000/auth/google`
   - Approve consent and return to `/oauth2callback`

Default port is `3000`. Override with `PORT` in `backend/.env`.

## API Endpoints
- `GET /health`
- `GET /auth/status`
- `POST /auth/logout`
- `GET /triage?limit=N`

## Curl Examples
Before auth (expected `401`):
```powershell
curl.exe -i "http://localhost:3000/triage?limit=1"
```

After auth (expected `200` with triage items):
```powershell
curl.exe "http://localhost:3000/auth/status"
curl.exe -i "http://localhost:3000/triage?limit=1"
```

Minimal status + reset flow:
```powershell
curl.exe "http://localhost:3000/auth/status"
curl.exe -X POST "http://localhost:3000/auth/logout"
curl.exe "http://localhost:3000/auth/status"
```

## Secret Check Commands
Run these before committing:
```powershell
git status --short
git ls-files | findstr /I "env credentials token data"
git check-ignore -v backend/data/token.json
```
