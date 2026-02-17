# Deployment Guide (Milestone 7)

Default hosting choice: **Render** (simple managed HTTPS + easy Docker deploy).

## 1) Environment and secrets
Do not commit these files:
- `backend/.env`
- `backend/credentials.json`
- `backend/data/token.json`

In Render backend service env vars set:
- `PORT=3000`
- `FRONTEND_REDIRECT_URL=https://<your-frontend-domain>`
- `CORS_ORIGIN=https://<your-frontend-domain>`

## 2) Backend service (Docker)
- Create new Render Web Service from this repo.
- Use `Dockerfile.backend`.
- Mount Google OAuth credentials as a secret file (or secure env/file mechanism) at `/app/credentials.json`.
- Persistent disk path: `/app/data` (for token persistence).

## 3) Frontend service (Docker)
- Create second Render Web Service (or Static Site) from same repo.
- Use `Dockerfile.frontend`.
- Build arg:
  - `VITE_API_BASE_URL=https://<your-backend-domain>`

## 4) Google OAuth redirect configuration
In Google Cloud OAuth client:
- add backend callback URL:
  - `https://<your-backend-domain>/oauth2callback`

## 5) HTTPS and CORS
- Render provides HTTPS by default.
- Backend CORS is controlled by `CORS_ORIGIN`.
- Set it to your exact frontend origin.

## 6) Local Docker test
From repo root:
```powershell
docker compose up --build
```
- Frontend: `http://localhost:8080`
- Backend: `http://localhost:3000`

## 7) Post-deploy smoke
```powershell
curl.exe https://<your-backend-domain>/health
curl.exe https://<your-backend-domain>/auth/status
curl.exe -i "https://<your-backend-domain>/triage?limit=1"
```
Expected:
- health 200
- auth/status JSON keys present
- triage 401 unauth or 200 authed
- never OpenAI quota text
