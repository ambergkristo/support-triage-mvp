# OpsInbox Backlog

## Immediate (Execution)
1. M2: Add SQLite migration runner and durable schema (`users`, `inbox_accounts`, `messages`, `triage_results`, `assignments`, `notes`, `activity_log`, `rule_configs`, `feature_flags`).
2. M2: Replace in-memory overrides/rules/flags with SQLite repositories.
3. M2: Persist triage outputs and message metadata for restart-safe recovery.
4. M3: Add multi-user auth abstraction and workspace linkage.
5. M4: Assignment ownership + status workflow persistence.
6. M5: SLA escalation engine and Slack webhook adapter.
7. M6: Audit retrieval endpoints and admin activity views.
8. M7: Production middleware (rate limiting, security headers) and release image hardening.
9. M8: Plan limits and feature gating for monetizable tiers.

## Later
1. Rules simulation UI for admins.
2. AI shadow mode quality dashboard.
3. Compliance export package for enterprise buyers.
