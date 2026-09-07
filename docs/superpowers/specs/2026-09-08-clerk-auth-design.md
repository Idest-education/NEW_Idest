# Clerk Authentication — Design

**Date:** 2026-09-08
**Status:** Approved (design), pending implementation plan
**Scope:** Add authentication to the monorepo (`apps/web`, `apps/server`) using Clerk, with a
local PostgreSQL `users` table as the authorization source of truth.

## 1. Context

The repository is a fresh `create-turbo` scaffold with a single initial commit. No
authentication, no persistence layer, and no shared domain package exist yet.

- `apps/web` — Next.js 16 (App Router), React 19, pnpm.
- `apps/server` — NestJS 12, TypeScript, Vitest, oxlint. Only the default
  `app.controller` / `app.service` / `app.module`.
- `packages/` — `eslint-config`, `typescript-config`, `ui`.
- A Python FastAPI AI-scoring service and a RabbitMQ worker are planned but not present.

The ClickUp `Database Schema` and `User Roles & Responsibilities` docs already commit to:

- A local `users` table as the source of truth (`id UUID`, `email`, `display_name`,
  `role`, `status`, timestamps, `deleted_at`).
- Roles `student`, `teacher`, `admin` (MVP uses `teacher` + `student`; `admin` restricted
  to the project team).
- Server-side enforcement of authorization.
- History append-only; no hard deletes of core records.

## 2. Decisions

| # | Decision |
| --- | --- |
| D1 | Clerk provides **authentication only** (identity, sessions, sign-in/up UI). Authorization is decided by the NestJS API against the local Postgres `users` row. |
| D2 | The user's `role` is **mirrored into Clerk `publicMetadata`** so Next.js middleware can do coarse role gating at the edge. Postgres remains authoritative. |
| D3 | Local `users` rows are created **just-in-time** by the API on the first authenticated request for an unknown Clerk user, and kept in sync afterwards by **Clerk webhooks** (`user.updated`, `user.deleted`). |
| D4 | **Public sign-up creates a `teacher`.** Students join only through a **Clerk invitation** created by a teacher; the invitation carries `publicMetadata.role = "student"` and the inviting teacher's Clerk id. |
| D5 | `admin` has no self-serve path. It is set by a seed script (DB + Clerk metadata) run manually. |
| D6 | Web ↔ API auth boundary: the browser and Next.js server code call the NestJS API **directly** with a short-lived Clerk session token (`getToken()`); the API verifies it statelessly against Clerk JWKS with `@clerk/backend`. No BFF proxy. |
| D7 | Persistence is introduced now with **Prisma** + a `User` model only. Other domain tables are out of scope. |
| D8 | Local Postgres runs via a repo `docker-compose.yml`. |
| D9 | The FastAPI service and RabbitMQ worker are **not** Clerk-authenticated; they will use a shared service secret, specified separately. |

## 3. Architecture

```
Browser ──Clerk session cookie──> apps/web (Next.js)
   │                                  │  clerkMiddleware: session + coarse role gate
   │                                  │  ClerkProvider, <SignIn/> <SignUp/>
   │                                  ▼
   └──Authorization: Bearer <Clerk session JWT>──> apps/server (NestJS)
                                          ClerkAuthGuard  → verifyToken() vs Clerk JWKS
                                          RolesGuard      → local users.role (Postgres)
                                          UserSyncService → JIT create / webhook sync
                                                 │
                                                 ▼
                                          PostgreSQL (Prisma, users table)
                                                 ▲
Clerk  ──user.created / user.updated / user.deleted webhooks──┘  (svix-signed)
```

- **Authentication token:** Clerk session token obtained via `getToken()` (server:
  `auth().getToken()`, client: `useAuth().getToken()`), sent as a Bearer header. The API
  verifies signature, expiry, and `azp` against `CLERK_AUTHORIZED_PARTIES`. Verification is
  networkless after the JWKS is cached.
- **Coarse authorization (edge):** `apps/web` middleware reads `sessionClaims.metadata.role`
  and blocks obviously wrong role/route combinations. Advisory only.
- **Authoritative authorization (API):** `RolesGuard` loads the local `users` row and checks
  `role` and `status`. This is the only gate that governs data access.

## 4. Packages and layout

### 4.1 `@repo/auth-contract` (new — `packages/auth-contract/`)

Pure TypeScript, no runtime dependencies. Consumed by `apps/web` and `apps/server`.

```ts
export const ROLES = ['student', 'teacher', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface ClerkPublicMetadata {
  role?: Role;
  invitedBy?: string; // inviting teacher's Clerk user id
}

export interface SessionMetadataClaim {
  role?: Role;
}
```

Standard `@repo/*` package config (mirrors `packages/ui`): `package.json` with
`"exports"`, `tsconfig.json` extending `@repo/typescript-config`, an `eslint.config.js`.

### 4.2 `apps/web`

- Dependency: `@clerk/nextjs`. Dev dependency: `dotenv-cli`.
- `middleware.ts` — `clerkMiddleware`.
- `app/layout.tsx` — `<ClerkProvider>` inside `<body>`.
- `app/sign-in/[[...sign-in]]/page.tsx` — `<SignIn />`.
- `app/sign-up/[[...sign-up]]/page.tsx` — `<SignUp />`.
- `lib/api.ts` — `apiFetch()` helper that attaches the Bearer token.

### 4.3 `apps/server`

- Dependencies: `@clerk/backend`, `svix`, `@nestjs/config`, `@prisma/client`.
- Dev dependency: `prisma`.
- `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`.
- `src/prisma/` — `PrismaModule`, `PrismaService`.
- `src/auth/` — `AuthModule`, `clerk-client.provider.ts`, `clerk-auth.guard.ts`,
  `roles.guard.ts`, `decorators/` (`public.decorator.ts`, `roles.decorator.ts`,
  `current-user.decorator.ts`), `user-sync.service.ts`, `webhook.controller.ts`,
  `invitation.controller.ts`, `auth.exception-filter.ts`.

### 4.4 Repo root

- `docker-compose.yml` — one `postgres:17` service, named volume, port `5432`,
  database/user/password matching `DATABASE_URL`.
- `.env` (already present, gitignored) — new keys added (Section 9).

## 5. `apps/web` integration

### 5.1 Install

Run from `apps/web`:

```bash
npx -y clerk@latest init
```

The CLI detects Next.js 16 + pnpm, installs `@clerk/nextjs`, and scaffolds the provider,
middleware, and env var names. Its output is then adjusted to match this design. Do not pass
`--framework` or `--pm`. Do not run `clerk auth login` (real keys are supplied — Section 9).

### 5.2 Environment

The project uses a single root `.env`. Next.js does not read parent directories, so
`apps/web` scripts are wrapped with `dotenv-cli`:

```json
{
  "scripts": {
    "dev": "dotenv -e ../../.env -- next dev --port 3000",
    "build": "dotenv -e ../../.env -- next build",
    "start": "dotenv -e ../../.env -- next start"
  }
}
```

`turbo.json` already lists `.env*` in `build.inputs`; add the root `.env` to `globalEnv` or
`globalDependencies` so Turbo cache keys track it.

### 5.3 `middleware.ts`

- `clerkMiddleware`.
- Public routes (no session required): `/`, `/sign-in(.*)`, `/sign-up(.*)`.
- All other routes: redirect unauthenticated users to `/sign-in`.
- Coarse role gate using `(await auth()).sessionClaims?.metadata?.role`:
  - non-`teacher` requesting `/teacher(.*)` → redirect `/`.
  - non-`student` requesting `/student(.*)` → redirect `/`.
- The role gate is best-effort; the API is the real gate.

### 5.4 Provider and routes

- `app/layout.tsx`: `<ClerkProvider>` wraps `children` **inside** `<body>` (never around
  `<html>`).
- `<SignIn />` / `<SignUp />` rendered from the catch-all routes above.
- Public sign-up yields a user with no role; the API assigns `teacher` (Section 7).
- Student invitation links resolve to Clerk's hosted flow via the email ticket and return to
  `NEXT_PUBLIC_CLERK_SIGN_UP_URL`.

### 5.5 Calling the API

`lib/api.ts`:

```ts
// server component / route handler
import { auth } from '@clerk/nextjs/server';
const token = await (await auth()).getToken();

// client component
import { useAuth } from '@clerk/nextjs';
const { getToken } = useAuth();
```

`apiFetch(path, init)` prepends `NEXT_PUBLIC_API_URL` and sets
`Authorization: Bearer <token>`.

### 5.6 Manual Clerk Dashboard step

Sessions → **Customize session token** → add:

```json
{ "metadata": "{{user.public_metadata}}" }
```

so `sessionClaims.metadata.role` is available in middleware. Documented in
`apps/web/README.md`.

## 6. `apps/server` integration

### 6.1 Prisma layer

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  student
  teacher
  admin
}

enum UserStatus {
  active
  suspended
  deleted
}

model User {
  id              String     @id @default(uuid()) @db.Uuid
  clerkUserId     String     @unique @map("clerk_user_id")
  email           String     @unique
  displayName     String     @map("display_name")
  role            Role
  status          UserStatus @default(active)
  invitedByUserId String?    @map("invited_by_user_id") @db.Uuid
  invitedBy       User?      @relation("Invitations", fields: [invitedByUserId], references: [id])
  invitees        User[]     @relation("Invitations")
  createdAt       DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt       DateTime?  @map("deleted_at") @db.Timestamptz(6)

  @@map("users")
}
```

- `PrismaService extends PrismaClient` with `onModuleInit` → `$connect()`.
- `PrismaModule` is global; exports `PrismaService`.
- First migration: `prisma migrate dev --name init_users`.

**Schema additions beyond the ClickUp `Database Schema` doc:** `clerk_user_id` (unique) and
`invited_by_user_id` (self-referential, nullable — scopes a teacher's student list). The
ClickUp doc must be updated to match after this lands.

### 6.2 Clerk client

`clerk-client.provider.ts` — a provider token `CLERK_CLIENT` bound to
`createClerkClient({ secretKey: config.get('CLERK_SECRET_KEY') })`. Exported by `AuthModule`.

### 6.3 `ClerkAuthGuard` (global, `APP_GUARD`)

1. If the handler or its controller carries `@Public()`, allow.
2. Read `Authorization`; missing/not `Bearer ` → `UnauthorizedException` (`401`,
   `{ error: 'unauthenticated' }`).
3. `verifyToken(token, { secretKey, authorizedParties: CLERK_AUTHORIZED_PARTIES.split(',') })`.
4. Any failure (expired, bad signature, wrong `azp`) → `401`.
5. Attach `req.auth = { clerkUserId: payload.sub, sessionId: payload.sid, claims: payload }`.

### 6.4 `RolesGuard` (global, after `ClerkAuthGuard`)

1. Read `@Roles(...)` metadata; absent → allow.
2. `user = await userSync.getOrCreate(req.auth)`.
3. `user.status !== 'active'` → `ForbiddenException` (`403`, `{ error: 'forbidden' }`).
4. `user.role` not in the allowed set → `403`.
5. Attach `req.localUser = user` for reuse by `@CurrentUser()`.

### 6.5 Decorators

- `@Public()` — `SetMetadata('isPublic', true)`.
- `@Roles(...roles: Role[])` — `SetMetadata('roles', roles)`.
- `@CurrentUser()` — param decorator returning `req.localUser ?? await userSync.getOrCreate(req.auth)`.

### 6.6 `UserSyncService`

`getOrCreate({ clerkUserId, claims }): Promise<User>`

1. `prisma.user.findUnique({ where: { clerkUserId } })` → return if found.
2. Not found → `clerkClient.users.getUser(clerkUserId)`. If the Clerk API is unreachable →
   `ServiceUnavailableException` (`503`); no partial write.
3. `role = clerkUser.publicMetadata.role ?? 'teacher'`.
4. Resolve `invitedByUserId`: if `publicMetadata.invitedBy` is set, look up the local user by
   that Clerk id; `null` if absent.
5. `prisma.user.create({ data: { clerkUserId, email, displayName, role, status: 'active', invitedByUserId } })`.
   - `email` / `displayName` derived from the Clerk user (primary email address; name or
     email local-part fallback).
   - On `P2002` (unique race) → re-read and return the existing row.
6. If `role` was defaulted (step 3 used the fallback), call
   `clerkClient.users.updateUserMetadata(clerkUserId, { publicMetadata: { role: 'teacher' } })`
   so the session claim mirrors the DB.
7. `// TODO(persistence): emit audit_events row once that table exists.`

`handleWebhook(evt: WebhookEvent): Promise<void>`

- `user.updated` — upsert by `clerkUserId`; update `email`, `displayName`, `status`. Update
  `role` **only** when `publicMetadata.role` is present and differs (supports an admin
  promotion performed in Clerk).
- `user.deleted` — set `status = 'deleted'`, `deletedAt = now()`. Never hard delete.
- Unknown `clerkUserId` on `user.updated` — create via the same path as `getOrCreate`
  steps 3–5.
- All operations idempotent.

### 6.7 `WebhookController` — `POST /webhooks/clerk`

- `@Public()`.
- Needs the raw request body: enable `rawBody: true` in `NestFactory.create` and read
  `req.rawBody` (or a small raw-body middleware scoped to this path).
- Verify with `new Webhook(CLERK_WEBHOOK_SIGNING_SECRET).verify(rawBody, svixHeaders)`.
  Invalid → `BadRequestException` (`400`), no processing.
- Dispatch to `UserSyncService.handleWebhook`. A thrown handler error propagates as `500`
  so svix retries; handlers are idempotent.

### 6.8 `InvitationController` — `POST /invitations`

- `@Roles('teacher')`.
- Body: `{ email: string }` (validated with `class-validator`: `@IsEmail()`).
- `clerkClient.invitations.createInvitation({ emailAddress: email, publicMetadata: { role: 'student', invitedBy: req.auth.clerkUserId }, redirectUrl: <NEXT_PUBLIC_APP_URL>/sign-up, notify: true })`.
- Clerk `422` "already exists / already a member" → `ConflictException` (`409`,
  `{ error: 'invitation_exists' }`).
- No local pending-invitation record. The student's `users` row appears via the
  `user.created` webhook or JIT on first API call, with `role = 'student'` and
  `invitedByUserId` linked.

### 6.9 `admin` seed

`prisma/seed.ts` — given an email (env or argv), set the matching `users.role = 'admin'`
and call `clerkClient.users.updateUserMetadata` to mirror. Registered via the
`"prisma": { "seed": "tsx prisma/seed.ts" }` key in `apps/server/package.json`; run manually
(`pnpm --filter server exec prisma db seed`).

### 6.10 CORS and exception shape

- `main.ts` — `app.listen(3001)` (web owns `3000`);
  `app.enableCors({ origin: CLERK_AUTHORIZED_PARTIES.split(','), allowedHeaders: ['Authorization', 'Content-Type'], credentials: true })`.
- `AuthExceptionFilter` (or a global filter) renders known exceptions as `{ error: <code> }`.

## 7. Role and invitation flow

### 7.1 Teacher (public sign-up)

1. User signs up through `<SignUp />`. Clerk user created, no `publicMetadata.role`.
2. `user.created` webhook → `handleWebhook` (unknown id path) **or** first API call → JIT.
3. Role resolves to the `teacher` default; DB row created; Clerk `publicMetadata.role` set
   to `teacher`.
4. Subsequent session tokens carry `metadata.role = "teacher"`.

### 7.2 Student (invited)

1. Teacher calls `POST /invitations` with the student's email.
2. Clerk sends an invitation email; `publicMetadata` pre-set to
   `{ role: 'student', invitedBy: <teacher clerk id> }`.
3. Student accepts, completes Clerk sign-up via the ticket.
4. `user.created` webhook / JIT → DB row with `role = 'student'`,
   `invitedByUserId = <teacher local id>`. `publicMetadata.role` already correct, so no
   metadata write.

### 7.3 Admin

Seed script only (Section 6.9).

## 8. Error handling

| Condition | Response |
| --- | --- |
| No / malformed bearer token | `401 { error: 'unauthenticated' }` |
| Token fails verification (expiry, signature, `azp`) | `401 { error: 'unauthenticated' }` |
| Authenticated, role not allowed, or `status != active` | `403 { error: 'forbidden' }` |
| Clerk API unreachable during JIT user fetch | `503` — no DB write |
| Invitation email already invited / already a user | `409 { error: 'invitation_exists' }` |
| Webhook signature invalid | `400` — not processed |
| Webhook handler throws | `500` — svix retries; handlers idempotent |
| JWKS fetch failure in the guard | Fail closed → `401`, log the cause |

## 9. Configuration

Root `.env` (gitignored; values supplied by the project owner from the Clerk dashboard and
the local database):

```
DATABASE_URL=postgresql://idest:idest@localhost:5432/idest
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
CLERK_AUTHORIZED_PARTIES=http://localhost:3000
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- `apps/server` reads the root file via `ConfigModule.forRoot({ envFilePath: ['../../.env'], isGlobal: true })`.
- `apps/web` reads it via `dotenv-cli` in its scripts.
- `docker-compose.yml` Postgres credentials match `DATABASE_URL`.
- Local webhook development: expose `apps/server` with a tunnel (ngrok or the Clerk CLI) and
  register the URL in the Clerk dashboard. Steps recorded in `apps/server/README.md`.
- Never expose `CLERK_SECRET_KEY` or `CLERK_WEBHOOK_SIGNING_SECRET` to client code. Do not
  read or print `.env` during implementation; only append the key names and document them.

## 10. Testing

### 10.1 `apps/server` unit (Vitest)

- `ClerkAuthGuard`: valid token; expired; wrong `azp`; missing header; `@Public()` bypass.
  `verifyToken` mocked.
- `RolesGuard`: allowed role; disallowed role; `suspended` / `deleted` status; no `@Roles`.
- `UserSyncService.getOrCreate`: existing row; new user → `teacher` default (+ metadata
  write asserted); new user with `publicMetadata.role = student` + `invitedBy` → linked;
  Clerk API failure → `503`; `P2002` race → returns existing.
- `UserSyncService.handleWebhook`: `user.updated` (email/status change; role change only
  when metadata present); `user.deleted` → soft delete; unknown id → create.
- Webhook signature verification: valid; tampered payload; replayed timestamp.
- `InvitationController`: teacher → Clerk client mocked, `201`; Clerk `422` → `409`.

### 10.2 `apps/server` e2e (`vitest.config.e2e.ts`, disposable Postgres)

- Protected route without token → `401`.
- Protected route with a valid request: the Nest test module injects a fake token verifier
  (returning a fixed payload); no real JWKS or Clerk call → `200`.
- `@Roles('teacher')` route as a `student` → `403`.
- `POST /webhooks/clerk` with a valid svix signature → `users` row upserted.
- `POST /invitations` as a teacher (Clerk client mocked) → `201`.

CI performs no live Clerk calls: the Nest test module injects a fake token verifier and a
mocked Clerk client.

### 10.3 `apps/web`

- Unit-test the middleware route matcher: public vs protected vs role-prefixed paths, and
  the role-gate redirects given a stubbed `sessionClaims`.
- No tests against Clerk-hosted UI.

## 11. Out of scope (YAGNI)

Clerk Organizations; MFA and social-provider configuration; a pending-invitation table;
an admin UI; FastAPI / RabbitMQ-worker authentication (shared service secret, separate
spec); `audit_events` writes (deferred to the persistence task); session-revocation
propagation beyond `user.deleted`; rate limiting; sign-in UI theming beyond an `appearance`
passthrough; all other domain tables.

## 12. Build sequence

1. `@repo/auth-contract` package.
2. `docker-compose.yml` Postgres; Prisma setup; `User` model; `init_users` migration;
   `PrismaModule` / `PrismaService`.
3. `apps/web`: `clerk init`, `dotenv-cli` scripts, `middleware.ts`, `ClerkProvider`,
   sign-in/up routes, `lib/api.ts`.
4. `apps/server`: `AuthModule` — Clerk client provider, `ClerkAuthGuard`, `RolesGuard`,
   decorators, `UserSyncService`, exception filter, CORS.
5. `WebhookController` and `InvitationController`.
6. `prisma/seed.ts` admin seed.
7. Tests alongside each step; full `pnpm --filter server test` and `lint` green at the end.

## 13. Follow-ups (not this spec)

- Update the ClickUp `Database Schema` doc with `clerk_user_id` and `invited_by_user_id`.
- Update the ClickUp `User Roles & Responsibilities` doc: public sign-up = teacher, students
  are invitation-only.
- Record the Clerk dashboard session-token customization in `apps/web/README.md`.
- Specify FastAPI / worker service-to-service auth.
