# Repository Agent Guidelines

## Branch Naming
- Use `feat/*` for new features.
- Use `fix/*` for bug fixes.
- Use `chore/*` for maintenance, docs, tooling, and CI updates.

## Pull Request Checklist
- [ ] No secrets are committed (`backend/.env`, `credentials.json`, tokens, API keys, `sk-` keys).
- [ ] Relevant commands were run locally (at minimum backend install + typecheck/build path).
- [ ] Include proof of validation in the PR description:
  - command outputs or log snippets
  - screenshots where UI behavior is affected
- [ ] PR scope is focused and branch follows naming convention.

## Run Backend Locally
1. Create env file from template:
   - Copy `backend/.env.example` to `backend/.env`
2. Ensure OAuth credentials file exists:
   - Copy `backend/credentials.example.json` to `backend/credentials.json` and fill values
3. Install and run:
   - `cd backend`
   - `npm ci`
   - `npm run dev:safe`
4. Optional sanity check:
   - Open `http://localhost:3000/auth/google`

## Architecture Decisions
- Product direction is now `OpsInbox` (B2B operational inbox), not a demo MVP.
- Source layering standard inside backend:
  - `src/api`
  - `src/application`
  - `src/domain`
  - `src/infrastructure`
- Deterministic triage remains default; any future AI mode must be feature-flagged with safe rules fallback.

## Mistakes Found
- Previous stacked PR sequence was merged partially, causing missing milestone changes on `main`.
- Repo had dead/duplicate folders (`untitled/`, `backend/backend/`) that created path confusion.

## Anti-Patterns To Avoid
- Keeping operational state only in memory.
- Mixing API routes, domain logic, and infrastructure clients in a single file without boundaries.
- Relying on implicit production defaults for security-sensitive config.
