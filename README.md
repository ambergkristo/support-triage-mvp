# Support Triage MVP

Local MVP that:
- OAuths with Google (Gmail readonly)
- Reads recent Gmail message metadata and message details
- (Optional) Uses OpenAI to classify/triage

## Backend setup
1. Create `backend/.env` from `backend/.env.example` and set values:
   - `PORT=3000` (or your preferred port)
   - `OPENAI_API_KEY=...` (required for `/triage`)
   - `GOOGLE_CLIENT_ID=...`
   - `GOOGLE_CLIENT_SECRET=...`
   - `GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback`

2. Install and run backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```

## OAuth flow
1. Open `http://localhost:3000/auth/google` in a browser.
2. Sign in and grant Gmail readonly consent.
3. Google redirects to `/oauth2callback`; backend exchanges code and stores tokens at:
   - `backend/.data/token.json` (gitignored, local dev only)
4. On restart, backend auto-loads `backend/.data/token.json` if present.

## API endpoints
- `GET /gmail/messages?limit=10`
  - Returns message metas: `id`, `threadId`, `subject`, `from`, `date`, `snippet`
- `GET /gmail/messages/:id`
  - Returns message details: `id`, `threadId`, `headers`, `snippet`, `plainTextBody` (when available)

If OAuth tokens are missing, both endpoints return `401` with a clear auth message.

## Sample curl commands
```bash
# list latest 5 messages
curl "http://localhost:3000/gmail/messages?limit=5"

# get one message by id
curl "http://localhost:3000/gmail/messages/REPLACE_MESSAGE_ID"

# trigger OAuth from browser first:
# http://localhost:3000/auth/google
```

## Notes
- Do not commit `backend/.env` or `backend/.data/token.json`.
- `credentials.json` is not required.
