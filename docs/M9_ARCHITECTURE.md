# Milestone 9 Architecture (Post-MVP)

## Goals
- Multi-user foundation
- Team inbox concept
- Rules admin UI direction
- AI re-enable strategy with safe fallback

## Proposed architecture

### 1) Multi-user support (incremental)
- Introduce `users` table/model and OAuth identity binding (`google_sub`, `email`).
- Partition persisted data by user:
  - tokens
  - triage overrides
  - rules
- API auth model:
  - phase 1: session cookie/JWT per user
  - phase 2: role-based access (agent/admin)

### 2) Team inbox concept
- Introduce logical `workspace` and `team_membership`.
- Team inbox items map email/thread to assignee + status.
- Suggested states:
  - `new`
  - `in_progress`
  - `blocked`
  - `done`

### 3) Rules UI/admin model
- Rules are workspace-scoped and ordered.
- Rule structure:
  - matchers (domain, keywords, regex optional)
  - output (priority/category/action template)
  - enabled/disabled
- Conflict resolution:
  - highest score wins
  - deterministic tie-break by explicit rule order

### 4) AI re-enable toggle (safe)
- Feature flag model:
  - `aiTriageEnabled` bool
  - `aiMode` (`disabled`, `shadow`)
  - `safeFallback` fixed to `rules`
- Runtime policy:
  - if AI disabled OR AI fails/timeouts/rate-limits => always return rule-based triage
  - never block response on AI availability

## Scaffold implemented in this milestone
- Backend endpoints (MVP scaffolding):
  - `GET /admin/rules`
  - `POST /admin/rules`
  - `GET /team/inbox`
  - `GET /feature-flags`
  - `PATCH /feature-flags/ai`
- Frontend placeholder panel for post-MVP controls and flag visibility.

## Risks / next implementation steps
1. Add persistent DB schema for users/workspaces/rules/assignments.
2. Add auth middleware with per-user access checks.
3. Add optimistic locking/versioning for rules edits.
4. Add audit entries for admin rules changes and flag flips.
