# Security & Compliance Notes (Milestone 8)

## Scope principle
- Gmail scope is readonly only:
  - `https://www.googleapis.com/auth/gmail.readonly`

## Token storage encryption
- Token persistence file: `backend/data/token.json`
- If `TOKEN_ENCRYPTION_KEY` is set, token data is encrypted at rest (AES-256-GCM).
- If key is not set, fallback is plaintext for local dev compatibility.

## Audit logging
Backend logs structured JSON events for:
- request logs (`http_request`)
- OAuth success/failure (`auth_oauth_success`, `auth_oauth_failed`)
- logout events (`auth_logout`)

## Secret scanning / hygiene checklist
Run before pushing:
```powershell
git status --short
git ls-files | findstr /I "env credentials token data key secret"
git check-ignore -v backend/data/token.json
```

## Never commit
- `backend/.env`
- `backend/credentials.json`
- `backend/data/token.json`
- `token*.json`
- real refresh/access tokens
- real API keys
