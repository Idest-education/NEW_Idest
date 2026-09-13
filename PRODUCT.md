# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — IELTS teachers (freelance tutors first, small centers second).** A tutor
receives more essays than they can grade at the pace students need. Each essay takes real
reading time: checking task response, coherence, lexical resource, and grammar, then
writing feedback a learner can act on. Their job in this product is to review an AI
preliminary assessment, correct what is wrong, and publish a result they are willing to
put their name on. They are the final authority, not a reviewer of record.

**Primary — IELTS Writing students (Vietnamese learners).** They write an essay for a
given task, submit it, wait for the teacher-approved result, and read the band scores plus
feedback to know what to fix next. They never see AI output, teacher revisions, internal
notes, or failed scoring attempts — only the published result and their own history.

**Secondary — administrators.** Account and user management, system oversight. Out of MVP
surface scope; the role exists in the auth contract (`student`, `teacher`, `admin`).

**Secondary — the thesis audience** (supervisor TS. Lê Văn Tuấn, UIT examination
committee). The system must also be legible as an undergraduate thesis deliverable: the
teacher-in-the-loop mechanism and the AI-versus-teacher comparison have to be visible in
the product, not only in the report.

## Product Purpose

A website where a student submits an IELTS Writing essay, an LLM produces a preliminary
assessment (overall band, four criterion scores, and feedback), a teacher reviews, edits,
and approves it, and the student sees only the published result.

The product exists because AI grading alone is not reliable or stable enough to hand a
learner a band score, and unaided human grading does not scale to a tutor's real caseload.
Success means: the teacher's time per essay drops without the teacher losing control of
the outcome, the student gets faster and specific feedback, and every AI result plus every
teacher correction is stored separately to build a benchmark dataset.

## Positioning

The mechanism a pure AI grader cannot copy: **the teacher publishes, the AI only drafts.**
AI output is preliminary until a human approves it, and the disagreement between the two
is not discarded — it is the product's asset. AI results and teacher revisions are stored
as separate append-only records, which produces a teacher-graded benchmark dataset used to
evaluate the LLM and later to train and compare a CatBoost ML model (QWK, accuracy,
deviation rate).

## Operating Context

- **Language: the interface is Vietnamese.** Labels, navigation, states, and error
  messages are in Vietnamese. Essay content, IELTS criterion names, and AI/teacher feedback
  on the writing itself remain in English — that is the subject being assessed.
- **Devices: fully responsive, equal weight.** Students may write and submit essays on a
  phone as well as a laptop; teachers may review on either. No surface is desktop-only.
- Students type essays directly in the app. Image upload and OCR are deferred (ADR-002).
- Scoring is asynchronous: submitting must never block on the AI, and a scoring failure
  must never lose the submission — it is retryable without resubmission.
- Submission lifecycle the UI must express:
  `submitted → queued → scoring → scored → under_review → published`, plus `failed`
  (retry returns to `queued`).
- Project management lives in ClickUp (workspace **Idest**); authoritative product,
  requirements, design, and ADR documents are ClickUp docs, mapped in `CLAUDE.md`.
- Timeline: 2026-09-07 → 2026-12-28. Sprint 2 begins pilot teacher onboarding, so real
  tutors touch the interface inside the project window.

## Capabilities and Constraints

**Confirmed capabilities (thesis scope):** account management with role-based access
(student / teacher / admin); essay submission with draft save, prompt, timestamp, and
status; LLM preliminary scoring producing four criterion bands plus strengths,
weaknesses, and improvement suggestions in a fixed structure; teacher review that can edit
every score and every comment and then publish; student view of published results and
history; append-only storage of AI results and teacher revisions; model evaluation and
comparison (LLM vs ML vs teacher).

**Technical constraints:** Turborepo monorepo (pnpm). `apps/web` is Next.js + TypeScript
and is the only user-facing surface. `apps/server` is NestJS. `apps/ai-service` is Python
FastAPI. PostgreSQL with `JSONB` for AI output; RabbitMQ for async scoring; S3-compatible
object storage. Authentication is Clerk (`@clerk/nextjs`), with role carried in Clerk
public metadata; authorization is enforced server-side, never in the client. UI
dependencies already present: Tailwind CSS v4, framer-motion, lucide-react, clsx,
tailwind-merge, canvas-confetti, local Geist Sans/Mono fonts.

**Non-negotiable product rules:** the teacher is the final authority; history is
append-only and nothing is ever overwritten; every AI result records its
`ai_model_versions` reference; students see only `published_results`; publishing and
revision creation are single transactions; on failure, prefer rejecting or delaying an
operation over showing or persisting an incorrect score.

**Explicitly undecided:** admin surfaces beyond basic user management; whether PostgreSQL
+ JSONB alone suffices or a separate document database is needed (ADR-001, Proposed);
pricing, licensing, and any deployment or hosting commitment — none exist.

## Brand Commitments

- Product name: **Idest** (confirmed).
- A logo and brand assets exist outside the repository; the user will add the local files
  to the project. Nothing brand-related is in the repo today — the only images present are
  Turborepo/Next.js/Vercel scaffold SVGs in `apps/web/public/`, which are not Idest assets
  and must not be treated as identity.
- Voice: Vietnamese interface copy. No tone-of-voice document has been established yet.
- The current `apps/web` UI is the unmodified `create-turbo` starter page plus Clerk
  sign-in/sign-up and a profile form. It is scaffold, not an incumbent design system, and
  carries no brand authority.

## Evidence on Hand

- `docs/thesis.txt` — plain-text extract of the signed thesis assignment: objectives,
  scope, functional breakdown, method, technology, expected results, schedule.
- `docs/KLTN-23520455-23521137.pdf` — the original signed assignment.
- `docs/CLICKUP.md` — how to fetch the live product, requirements, system design, and ADR
  documents from ClickUp via REST.
- Working code: Prisma schema and migrations, NestJS modules for assignments,
  submissions, AI scoring persistence, revisions and publishing, a FastAPI AI service with
  a Gemini LLM worker over RabbitMQ, and E2E tests for the core flows.

**Absences future work must not fabricate:** no real students or teachers have used the
system yet, so there are no testimonials, no usage numbers, no accuracy benchmarks, no
case studies, and no press. There is no trained CatBoost model and no QWK figure yet. No
pricing, no customer logos, no partner claims, no real Idest screenshots.

## Product Principles

1. **The teacher's judgment is the product.** Every interface decision must make
   correcting the AI faster than grading from scratch, and must never make approving the
   AI's draft the path of least resistance.
2. **Nothing is overwritten, so nothing is hidden.** AI output, teacher edits, and
   published results are distinct records; the interface should reflect that separation
   rather than blur it into one editable score.
3. **The student's view is a clean boundary.** Only published results reach the student —
   no AI drafts, no revision trails, no failure states, no internal notes.
4. **Waiting is a designed state, not a gap.** Scoring is asynchronous and can fail; queued,
   scoring, failed, and retry are first-class screens, not spinners.
5. **Say what is preliminary and what is final.** A score's status and authorship must be
   unambiguous everywhere it appears.

## Accessibility & Inclusion

- Vietnamese-language interface with English essay content: both scripts must render
  correctly in the chosen typefaces, including full Vietnamese diacritics.
- Fully responsive down to phone widths, since students may write essays on mobile.
- No specific conformance standard has been mandated by the university or the supervisor.
