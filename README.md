# Support Triage MVP

Local MVP that:
- OAuths with Google (Gmail readonly)
- Reads recent email metadata/snippets
- (Optional) Uses OpenAI to classify/triage

## Local setup
1. Copy required templates:
   - `cp backend/.env.example backend/.env` (PowerShell: `Copy-Item backend/.env.example backend/.env`)
   - `cp backend/credentials.example.json backend/credentials.json` (PowerShell: `Copy-Item backend/credentials.example.json backend/credentials.json`)
2. Install dependencies:
   - `cd backend`
   - `npm ci`
3. Start the backend:
   - `npm run dev`
4. Run OAuth flow:
   - Open `http://localhost:3000/auth/google`
   - After consent, Google redirects to `/oauth2callback`

## Dev sanity check
1. In `backend`, run `npm run dev`.
2. Verify `http://localhost:3000/` returns `{"status":"API running"}`.
3. Verify `GET http://localhost:3000/triage` returns JSON errors for missing OAuth or missing `OPENAI_API_KEY`.

## Smoke check (failure modes)
1. From repo root, run:
   - `backend/node_modules/.bin/tsc.cmd scripts/smoke-triage.ts --outDir .tmp-smoke --module commonjs --target es2020 --esModuleInterop --skipLibCheck`
   - `node .tmp-smoke/smoke-triage.js`
2. The script validates:
   - `GET /triage` without OAuth credentials returns `401` JSON.
   - Missing `OPENAI_API_KEY` returns `500` JSON with a clear message.

## Environment variables
Set these in `backend/.env`:
- `OPENAI_API_KEY=` your OpenAI API key
- `PORT=3000` backend port

## Notes
- OAuth flow (brief): `/auth/google` sends the user to Google consent; `/oauth2callback` receives the authorization code and stores tokens locally for Gmail API use.
- Do NOT commit `backend/.env`, `backend/credentials.json`, or token files.
