# Architecture Reset (M1)

## Before
- Monolithic backend route file handling API + domain + infra concerns.
- Dead folders (`untitled/`, `backend/backend/`) caused repository ambiguity.
- Environment parsing scattered via direct `process.env` reads.

## After
- Layering introduced:
  - `src/api/serverApp.ts` (HTTP entry and route wiring)
  - `src/application/*` (application orchestration helpers)
  - `src/domain/*` (business rules)
  - `src/infrastructure/*` (Gmail/token/env)
- Legacy import compatibility preserved through thin re-export modules.
- Central environment validation via `src/infrastructure/config/env.ts` using `zod`.

## Migration policy for next milestones
- New logic goes directly to layered paths.
- Legacy wrapper modules can be removed after references are fully migrated.
- Durable-state features in M2 must use repository interfaces under `application` + SQLite adapters under `infrastructure`.
