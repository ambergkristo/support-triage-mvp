# Agent Memory

## Durable decisions
- OpsInbox must remain deterministic-first. AI is optional and must always fallback safely to rules.
- Runtime source of truth during development remains `npm run dev:safe`.
- No in-memory business state after M2: persist overrides, assignments, notes, flags, rule configs.

## Mistakes observed
- Stacked PRs were merged out-of-order which left missing milestones on `main`.
- Local branch drift happened from committing on wrong branch once.

## Preventive rules
- Always verify target base branch exists remotely before PR creation.
- After merge notifications, verify merge graph with `gh pr view` and `git log` before continuing.
- Keep a recovery path via `fix/*` sync PR when merge-chain divergence happens.

## Anti-patterns to avoid
- Monolithic route files with mixed concerns.
- State kept only in memory for operational workflows.
- Production configs inferred from defaults without explicit validation.
