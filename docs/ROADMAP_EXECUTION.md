# Roadmap Execution (OpsInbox)

## Product Direction
Pivot from Gmail MVP to **OpsInbox**: a B2B operational inbox for small tech teams.

## Milestone Plan and Success Criteria

### M1 - Repo Hygiene & Architecture Reset
Scope:
- Remove dead folders (`untitled/`, duplicate `backend/backend/`)
- Establish source layering (`api/`, `application/`, `domain/`, `infrastructure/`)
- Validate env with `zod` in a single config entrypoint
- Create architecture reset notes
Success criteria:
- No dead folders in repo root/backend
- Backend starts and tests pass on new structure
- Docker files remain valid

### M2 - Durable State (SQLite Migration)
Scope:
- Replace in-memory overrides/flags/rules with SQLite tables
- Add migration runner and base schema
- Persist triage results
Success criteria:
- Restart does not lose overrides/rules/flags/results
- Migration command idempotent

### M3 - Multi-User Foundation
Scope:
- Add user/workspace tables
- Attach inbox account per user
- Add auth abstraction for future session/JWT
Success criteria:
- Two users can coexist with isolated inbox state

### M4 - Assignment & Ownership
Scope:
- Assignment table + ownership updates
- Status lifecycle (`open`, `acknowledged`, `done`)
- Activity log entries per action
Success criteria:
- Assignment and status survive restart

### M5 - Escalation Rules
Scope:
- SLA rule configuration
- Escalation worker
- Slack webhook adapter
Success criteria:
- P0 escalation triggers automatically

### M6 - Observability
Scope:
- Structured logs
- Full audit query endpoint
- Admin activity UI module
Success criteria:
- End-to-end action trace retrievable

### M7 - Production Hardening
Scope:
- Production runtime command (no dev mode)
- env validation hard-fail
- rate limiting + security headers
- production Docker verification
Success criteria:
- Production image boots and passes smoke

### M8 - Monetizable Version
Scope:
- OpsInbox branding
- plan-tier feature gates
- workspace limits
- billing abstraction (plan gating only)
Success criteria:
- SaaS-ready UX and enforceable plan limits

## Execution discipline
- Small branches/PRs per slice
- Run gates before every PR:
  - backend install
  - backend tests
  - dev:safe start
  - health/auth/triage curls
  - unauth smoke
- If red: fix-first policy, no milestone advancement
