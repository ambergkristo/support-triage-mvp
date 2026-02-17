# Support Triage MVP

Rule-based Gmail triage workbench with Google OAuth.

## Project layout
- `backend/` Node + Express API
- `frontend/` React + Vite UI

Use repo root and these two directories only (avoid `backend/backend`).

## Prerequisites (Windows PowerShell)
- Node.js 20+
- npm
- Google Cloud OAuth client (Web app)

## Backend setup
1. Copy env and credentials templates:
```powershell
cd backend
Copy-Item .env.example .env
Copy-Item credentials.example.json credentials.json
```
2. Fill `backend/credentials.json` with your real Google OAuth credentials.
3. Confirm redirect URI in Google Cloud:
- `http://localhost:3000/oauth2callback`
4. Install and run backend:
```powershell
cd backend
npm install
npm run dev:safe
```

Optional frontend redirect after OAuth:
- In `backend/.env`, set:
- `FRONTEND_REDIRECT_URL=http://localhost:5173`

## Frontend setup
```powershell
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`.

## Browser flow (M5)
1. Click `Connect Google`.
2. Complete consent.
3. Return to frontend (auto if `FRONTEND_REDIRECT_URL` is set).
4. Status card shows connected/disconnected.
5. Triage table shows priority/from/subject/date/category.
6. Click a row to open detail (summary/action/body).

## API endpoints
- `GET /health`
- `GET /auth/status`
- `POST /auth/logout`
- `GET /triage?limit=N`
- `GET /gmail/messages?limit=&pageToken=`
- `GET /gmail/messages/:id`

## curl.exe checks
Unauthenticated:
```powershell
curl.exe -i "http://localhost:3000/triage?limit=1"
```

Status and health:
```powershell
curl.exe http://localhost:3000/health
curl.exe http://localhost:3000/auth/status
```

## Security notes
Never commit:
- `backend/.env`
- `backend/credentials.json`
- `backend/data/token.json`
- `token*.json`

## Deployment
See `DEPLOYMENT.md` for Docker and Render deployment steps (HTTPS + CORS config included).
