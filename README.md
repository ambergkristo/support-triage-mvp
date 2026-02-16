# Support Triage MVP

Local MVP that:
- OAuths with Google (Gmail readonly)
- Reads recent email metadata/snippets
- (Optional) Uses OpenAI to classify/triage

## Setup (backend)
1. Copy env + credentials templates:
   - backend/.env.example -> backend/.env
   - backend/credentials.example.json -> backend/credentials.json

2. Install + run:
   cd backend
   npm install
   npm run dev

3. OAuth flow:
   Open http://localhost:3000/auth/google
   After consent you'll be redirected to /oauth2callback and should see JSON success.

## Notes
- Do NOT commit backend/.env or backend/credentials.json
