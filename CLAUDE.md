# CLAUDE.md

## Project

**Development of a Teacher-in-the-Loop AI-Assisted System for IELTS Writing Assessment**
(VI: *Xây dựng hệ thống hỗ trợ đánh giá bài viết IELTS ứng dụng trí tuệ nhân tạo với sự tham gia của giáo viên*)

University of Information Technology (UIT), VNU-HCM — undergraduate thesis (KLTN).

| | |
| --- | --- |
| Supervisor | TS. Lê Văn Tuấn |
| Student 1 | Huỳnh Chí Hên — 23520455 |
| Student 2 | Nguyễn Cao Vũ Phan — 23521137 |
| Duration | 2026-09-07 → 2026-12-28 |
| Task management | ClickUp (workspace **Idest**) |
| Source control | GitHub |

### One-line summary

A website where students submit IELTS Writing essays, an LLM produces a preliminary
assessment (overall band + 4 criterion scores + feedback), a teacher reviews/edits/approves
it, and the student sees only the published result. AI results and teacher revisions are
stored separately (append-only) to build a benchmark dataset and later train + evaluate a
CatBoost ML model against the LLM and teacher scores.

## What this file is

This is a **directory**, not a spec. The authoritative, living project documentation lives
in **ClickUp**. This file tells you what exists and where to fetch it.

- `docs/` holds only files that must be version-controlled with the code. Everything else
  (product, requirements, design, ADRs, sprint tasks) is in ClickUp — go fetch it.
- When asked about product scope, requirements, architecture, data model, flows, or
  decisions: **read the relevant ClickUp doc** (see map below), do not guess from memory.
- When asked what to work on next: **read the ClickUp sprint tasks**.

## Repository layout

Turborepo monorepo (pnpm).

```
apps/
  server/   NestJS + TypeScript — core backend API (auth, assignments, submissions,
            review workflow, publication, history). Vitest, oxlint.
  web/      Next.js + TypeScript — teacher and student web client.
docs/       See "docs/ folder" below.
```

Planned but not yet in the repo: a Python **FastAPI** service for AI scoring, and a
**RabbitMQ** queue + background worker for async scoring jobs.

## Tech stack (from the thesis)

| Layer | Choice |
| --- | --- |
| Frontend | TypeScript, Next.js |
| Backend (core) | TypeScript, NestJS |
| Backend (AI scoring) | Python, FastAPI |
| Database | PostgreSQL (structured data + `JSONB` for flexible AI output) |
| Object storage | S3-compatible |
| Messaging | REST (sync), RabbitMQ (async scoring) |
| AI | LLM grader first (Ollama / ChatGPT); CatBoost ML model later |
| Design | Figma |
| Tooling | VS Code, Claude Code |

## docs/ folder

Keep this folder minimal. Current contents:

| File | Purpose | Keep? |
| --- | --- | --- |
| `CLAUDE.md` (this file, repo root) | Directory / entry point | yes |
| `docs/CLICKUP.md` | How to fetch ClickUp docs and tasks via the REST API (IDs, endpoints, auth, runnable examples) | yes |
| `docs/thesis.txt` | Plain-text extract of the official thesis assignment (đề tài chi tiết): objectives, scope, users, method, tech, expected results, full schedule | yes |
| `docs/KLTN-23520455-23521137.pdf` | Original signed thesis assignment PDF | yes |
| `docs/superpowers/specs/` | Engineering design specs produced by the brainstorming workflow, each **mirrored to a ClickUp doc** | yes |
| `docs/superpowers/plans/` | Task-by-task implementation plans for those specs; repo-only, not mirrored | yes |

Do not add product/design/requirements docs here — they belong in ClickUp. Engineering specs under
`docs/superpowers/specs/` are the one exception: they are written in the repo so they travel with the
code that implements them, and every one is mirrored to the matching ClickUp folder. When a spec
changes, update both copies.

## ClickUp — access

Full mechanics in **`docs/CLICKUP.md`**. Short version:

- Auth: `CLICKUP_TOKEN` env var, sent as the raw `Authorization` header (no `Bearer`).
- REST v2 (`https://api.clickup.com/api/v2`) for tasks/spaces/folders/lists.
- REST v3 (`https://api.clickup.com/api/v3`) for docs.
- The `mcp__clickup__*` MCP server currently returns "no authorized workspaces" — use REST.
- In this environment run network calls inside `ctx_execute` (raw `curl` is redirected).

| Item | Name | ID |
| --- | --- | --- |
| Workspace (team) | Idest | `1100360000004414` |
| Space | Idest | `1100360000021475` |

## ClickUp documents — map

Fetch a doc's content:
`GET /api/v3/workspaces/1100360000004414/docs/{doc_id}/pages?content_format=text%2Fmd`
Re-list all docs (IDs change if recreated):
`GET /api/v3/workspaces/1100360000004414/docs`

### Product Discovery — folder `1100360000026703`

| Doc | ID | Read it for |
| --- | --- | --- |
| Product Vision | `z8rp3etr9y-118` | vision, value prop, product principles, product boundaries |
| Target User | `z8rp3etr9y-158` | primary users (freelance IELTS tutors), secondary (small centers, students) |
| User Roles & Responsibilities | `z8rp3etr9y-198` | roles, responsibility matrix, role interactions; MVP = Teacher + Student |
| Product Scope | `z8rp3etr9y-218` | in/out of scope, MoSCoW priorities, MVP workflow |

### Requirements — folder `1100360000026704`

| Doc | ID | Read it for |
| --- | --- | --- |
| Functional requirements | `z8rp3etr9y-258` | FR-001…FR-055, business rules BR-001…BR-007 |
| Non-Functional requirements | `z8rp3etr9y-278` | NFR-001…NFR-030 (perf, reliability, security, observability); CAP stance = CP |

### System Design — folder `1100360000026706`

| Doc | ID | Read it for |
| --- | --- | --- |
| System Architecture | `z8rp3etr9y-298` | components, sync/async boundaries, data ownership, AD-001…AD-005 |
| Domain & Data Design | `z8rp3etr9y-318` | 8 core entities, relationships, data lifecycle, JSONB rules |
| Database Schema | `z8rp3etr9y-338` | PostgreSQL DDL: tables, columns, constraints, indexes, transaction boundaries |
| Core User Flows | `z8rp3etr9y-358` | 6 end-to-end flows, submission state machine, key design decisions |
| Assessment Analytics & Decision Tracking | `z8rp3etr9y-718` | AI-vs-teacher agreement metrics, revision reason tags, review timing, analytics views, benchmark export; mirrors `docs/superpowers/specs/2026-09-21-assessment-analytics-design.md` |
| Teacher Onboarding (Checklist + Spotlight) | `z8rp3etr9y-738` | new-teacher tutorial: dashboard checklist, in-page spotlight, `users.onboarding_dismissed_at`; mirrors `docs/superpowers/specs/2026-09-28-teacher-onboarding-design.md` |
| Class Invite by Email | `z8rp3etr9y-758` | class "Học viên" invite: add existing students, invite new ones via `class_invitations`, join on sign-up; mirrors `docs/superpowers/specs/2026-09-28-class-invite-by-email-design.md` |

### AI & ML — folder `1100360000026707`

| Doc | ID | Read it for |
| --- | --- | --- |
| AI Scoring & Evaluation (SƠ KHAI) | `z8rp3etr9y-378` | early/draft: scoring approaches, eval metrics (QWK etc.), research questions |

### ADR — folder `1100360000027465` (all Proposed, 2026-09-07, owner Hen)

| ADR | ID | Decision |
| --- | --- | --- |
| 001: Document database and JsonB on Relational database | `z8rp3etr9y-538` | investigate whether PostgreSQL + JSONB alone is sufficient; separate doc DB is fallback |
| 002: Essay Submission Method | `z8rp3etr9y-558` | start with in-app typing; image upload + OCR deferred |
| 003: Initial AI Scoring Approach | `z8rp3etr9y-578` | **decided**: LLM grader as initial baseline; collect teacher-graded data, then train + compare CatBoost |

Other folders exist but have no lists/docs yet: `05 Thesis (KLTN)` `1100360000026709`,
`06 Project Management` `1100360000026710`.

## ClickUp tasks

Lists live in **Sprint Folder** `1100360000027332`.
Fetch: `GET /api/v2/list/{list_id}/task?archived=false&include_closed=true`

| List | ID | Window |
| --- | --- | --- |
| Sprint 1 | `1100360000028044` | 2026-09-07 → 2026-09-20 |
| Sprint 2 | `1100360000028055` | 2026-09-21 → 2026-10-04 |

Sprint 1 covers auth & roles, essay submission, AI scoring, assessment persistence,
teacher review, final assessment, student result view, assessment history, basic user
management, basic evaluation & monitoring, plus thesis/setup tasks. Sprint 2 begins pilot
teacher onboarding. Always re-fetch for current status and assignees.

## Domain quick reference

Entities (all history append-only): `users`, `assignments`, `submissions`,
`scoring_results`, `score_revisions`, `published_results`, `ai_model_versions`,
`audit_events`.

Submission state machine:
`submitted → queued → scoring → scored → under_review → published`
(`failed` on scoring error; retry returns to `queued`).

## Non-negotiable rules (see ClickUp docs for detail)

1. **Teacher is the final authority.** AI output is preliminary until a teacher publishes.
2. **History is append-only.** Never overwrite an original submission, AI result, revision,
   or published version. Teacher edits are new `score_revisions` rows.
3. **Every AI result records its `ai_model_versions` reference** (model, version, config).
4. **Students see only `published_results`** — never internal AI output, revisions, notes,
   or failed attempts.
5. **AI scoring is asynchronous** and must not block user requests; a scoring failure must
   never lose or corrupt the submission and must be retryable without resubmission.
6. **CP over AP**: on failure, prefer rejecting/delaying an operation over returning or
   persisting incorrect data. Teacher decisions must not be lost.
7. **Publishing and revision creation are single DB transactions.**

## Working conventions

- Backend (`apps/server`): `pnpm test` (Vitest), `pnpm lint` (oxlint) before finishing.
- Enforce auth/authorization server-side, not in the client.
- No secrets in source; use env vars.
- Timestamps in UTC (`TIMESTAMPTZ`).
- If a ClickUp doc and this file disagree, the ClickUp doc wins — update this file.
