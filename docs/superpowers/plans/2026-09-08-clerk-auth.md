# Clerk Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clerk authentication to `apps/web` and `apps/server`, with a local PostgreSQL `users` table (via Prisma) as the authorization source of truth.

**Architecture:** Clerk handles authentication only. The browser and Next.js server code call the NestJS API directly with a short-lived Clerk session JWT; a global `ClerkAuthGuard` verifies it against Clerk JWKS with `@clerk/backend`. A `RolesGuard` then loads the local `users` row (created just-in-time, kept in sync by Clerk webhooks) and enforces `role`/`status`. The user's role is mirrored into Clerk `publicMetadata` so Next.js middleware can do coarse edge gating.

**Tech Stack:** TypeScript, NestJS 12, Next.js 16, Prisma + PostgreSQL 17, `@clerk/nextjs`, `@clerk/backend`, `svix`, Vitest, pnpm, Turborepo, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-08-clerk-auth-design.md`

## Global Constraints

- Node.js `>= 20.9.0`.
- Next.js 15+: `auth()` is async — always `await auth()`. `<ClerkProvider>` goes **inside** `<body>`, never wrapping `<html>`.
- Use `@clerk/nextjs` and `@clerk/backend` — never legacy names (`@clerk/clerk-react`, `@clerk/clerk-sdk-node`).
- Never expose `CLERK_SECRET_KEY` or `CLERK_WEBHOOK_SIGNING_SECRET` to client code.
- Do not read or print the contents of `.env`. Only append key **names** and document them; values are supplied by the project owner.
- `apps/server` uses NodeNext ESM: relative imports carry a `.js` suffix (e.g. `./prisma/prisma.service.js`). Package imports (`@repo/auth-contract`, `@clerk/backend`) do not.
- Roles are exactly `student | teacher | admin`. Statuses are exactly `active | suspended | deleted`.
- Postgres is authoritative for `role` and `status`; the JWT claim is advisory.
- History is append-only: never hard-delete a `users` row — set `status = 'deleted'`, `deletedAt`.
- The API listens on port `3001`; `apps/web` owns `3000`.
- All work happens on branch `feat/clerk-auth` (already created). One commit per task step marked "Commit".

## Prerequisites (do once before Task 2)

- `docker compose up -d` works and the repo `.env` already contains real Clerk keys
  (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) plus the keys listed in Task 11.
- If a key is missing, stop and ask the owner — do not invent values.

---

## File Structure

**New package — `packages/auth-contract/`**
- `package.json`, `tsconfig.json`, `eslint.config.js` — standard `@repo/*` wiring.
- `src/index.ts` — `ROLES`, `Role`, `USER_STATUSES`, `UserStatus`, `ClerkPublicMetadata`, `SessionMetadataClaim`, `isRole()`.
- `src/index.test.ts`.

**Repo root**
- `docker-compose.yml` — Postgres 17 (`idest` + `idest_test` databases).
- `docker/postgres-init.sql` — creates `idest_test`.
- `.env.example` — key names only (committed).
- `turbo.json` — add `globalDependencies` + `globalEnv` (modify).

**`apps/server/`**
- `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`.
- `src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`.
- `src/auth/clerk-client.provider.ts` — `CLERK_CLIENT` token + factory.
- `src/auth/types.ts` — `RequestAuth`.
- `src/auth/decorators/public.decorator.ts`, `roles.decorator.ts`, `current-user.decorator.ts`.
- `src/auth/clerk-auth.guard.ts`, `src/auth/roles.guard.ts`.
- `src/auth/user-sync.service.ts` — `getOrCreate()`, `handleWebhook()`.
- `src/auth/webhook.controller.ts`, `src/auth/invitation.controller.ts`, `src/auth/auth.controller.ts`.
- `src/auth/dto/create-invitation.dto.ts`.
- `src/auth/auth.exception-filter.ts` — `AllExceptionsFilter`.
- `src/auth/auth.module.ts`.
- `src/app.module.ts`, `src/main.ts`, `src/app.controller.ts` — modify.
- `test/setup-e2e.ts`, `test/auth.e2e-spec.ts`; `vitest.config.e2e.ts` — modify.

**`apps/web/`**
- `package.json` — deps + `dotenv-cli` script wrappers (modify).
- `middleware.ts`.
- `lib/route-access.ts`, `lib/route-access.test.ts`, `lib/api.ts`, `lib/api.test.ts`.
- `app/layout.tsx` — modify (add `<ClerkProvider>`).
- `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`.
- `README.md` — modify (webhook + dashboard notes).

---

## Task 1: `@repo/auth-contract` package

**Files:**
- Create: `packages/auth-contract/package.json`
- Create: `packages/auth-contract/tsconfig.json`
- Create: `packages/auth-contract/eslint.config.js`
- Create: `packages/auth-contract/src/index.ts`
- Test: `packages/auth-contract/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ROLES: readonly ['student','teacher','admin']`
  - `type Role = 'student' | 'teacher' | 'admin'`
  - `USER_STATUSES: readonly ['active','suspended','deleted']`
  - `type UserStatus = 'active' | 'suspended' | 'deleted'`
  - `interface ClerkPublicMetadata { role?: Role; invitedBy?: string }`
  - `interface SessionMetadataClaim { role?: Role }`
  - `function isRole(value: unknown): value is Role`

- [ ] **Step 1: Create the package manifest**

`packages/auth-contract/package.json`:

```json
{
  "name": "@repo/auth-contract",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "typescript": "7.0.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Create tsconfig and eslint config**

`packages/auth-contract/tsconfig.json` (extend `base.json` unchanged — it already sets
`module`/`moduleResolution: NodeNext`; do not override them):

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/auth-contract/eslint.config.js`:

```js
import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default config;
```

- [ ] **Step 3: Write the failing test**

`packages/auth-contract/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROLES, USER_STATUSES, isRole } from './index.js';

describe('auth-contract', () => {
  it('declares the three roles and three statuses', () => {
    expect([...ROLES]).toEqual(['student', 'teacher', 'admin']);
    expect([...USER_STATUSES]).toEqual(['active', 'suspended', 'deleted']);
  });

  it('isRole accepts every declared role', () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it('isRole rejects unknown strings and non-strings', () => {
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @repo/auth-contract test`
Expected: FAIL — `Cannot find module './index'` (file not created yet).

- [ ] **Step 5: Write the implementation**

`packages/auth-contract/src/index.ts`:

```ts
export const ROLES = ['student', 'teacher', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface ClerkPublicMetadata {
  role?: Role;
  /** Inviting teacher's Clerk user id, set on student invitations. */
  invitedBy?: string;
}

export interface SessionMetadataClaim {
  role?: Role;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
```

- [ ] **Step 6: Run tests and type-check**

Run: `pnpm --filter @repo/auth-contract test && pnpm --filter @repo/auth-contract check-types`
Expected: PASS.

- [ ] **Step 7: Install workspace dependency links**

Run: `pnpm install`
Expected: `@repo/auth-contract` resolves as a workspace package.

- [ ] **Step 8: Commit**

```bash
git add packages/auth-contract pnpm-lock.yaml
git commit -m "feat(auth-contract): add shared role and metadata types"
```

---

## Task 2: Postgres + Prisma layer

**Files:**
- Create: `docker-compose.yml`
- Create: `docker/postgres-init.sql`
- Create: `apps/server/prisma/schema.prisma`
- Create: `apps/server/src/prisma/prisma.service.ts`
- Create: `apps/server/src/prisma/prisma.module.ts`
- Modify: `apps/server/package.json` (deps, scripts, `prisma.seed`)
- Test: `apps/server/test/prisma.e2e-spec.ts`
- Modify: `apps/server/vitest.config.e2e.ts` (test DATABASE_URL)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PrismaService extends PrismaClient implements OnModuleInit` — `onModuleInit(): Promise<void>` calls `$connect()`.
  - `PrismaModule` — `@Global()`, exports `PrismaService`.
  - Prisma model `User` and enums `Role`, `UserStatus` from `@prisma/client`. `User` fields: `id: string`, `clerkUserId: string`, `email: string`, `displayName: string`, `role: Role`, `status: UserStatus`, `invitedByUserId: string | null`, `createdAt: Date`, `updatedAt: Date`, `deletedAt: Date | null`.

- [ ] **Step 1: Add the Compose stack**

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: idest
      POSTGRES_PASSWORD: idest
      POSTGRES_DB: idest
    ports:
      - "5432:5432"
    volumes:
      - idest-pg:/var/lib/postgresql/data
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/10-init.sql:ro

volumes:
  idest-pg:
```

`docker/postgres-init.sql`:

```sql
CREATE DATABASE idest_test;
```

- [ ] **Step 2: Start the database**

Run: `docker compose up -d && docker compose exec postgres pg_isready -U idest`
Expected: `accepting connections`.

- [ ] **Step 3: Add server dependencies**

Run:

```bash
pnpm --filter server add @prisma/client @nestjs/config @clerk/backend svix class-validator class-transformer
pnpm --filter server add -D prisma tsx
```

- [ ] **Step 4: Add Prisma scripts to `apps/server/package.json`**

Add to `"scripts"`:

```json
"prisma:generate": "prisma generate",
"prisma:migrate": "prisma migrate dev",
"prisma:deploy": "prisma migrate deploy",
"db:seed": "prisma db seed"
```

Add a top-level `"prisma"` block:

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

- [ ] **Step 5: Write the Prisma schema**

`apps/server/prisma/schema.prisma`:

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

- [ ] **Step 6: Create the first migration**

Run: `cd apps/server && DATABASE_URL=postgresql://idest:idest@localhost:5432/idest pnpm prisma migrate dev --name init_users`
Expected: migration file created under `apps/server/prisma/migrations/`, `users` table + enums created, client generated.

- [ ] **Step 7: Write `PrismaService` and `PrismaModule`**

`apps/server/src/prisma/prisma.service.ts`:

```ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
```

`apps/server/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 8: Point the e2e config at the test database**

Modify `apps/server/vitest.config.e2e.ts`:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: 'postgresql://idest:idest@localhost:5432/idest_test',
    },
    globalSetup: ['./test/setup-e2e.ts'],
  },
});
```

- [ ] **Step 9: Write the e2e global setup**

`apps/server/test/setup-e2e.ts`:

```ts
import { execSync } from 'node:child_process';

const TEST_DATABASE_URL = 'postgresql://idest:idest@localhost:5432/idest_test';

export default function setup(): void {
  execSync('pnpm prisma migrate deploy', {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
```

- [ ] **Step 10: Write the failing connectivity test**

`apps/server/test/prisma.e2e-spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('PrismaService (e2e)', () => {
  it('connects to the configured database and round-trips a query', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 AS ok');
    expect(rows).toEqual([{ ok: 1 }]);
    await prisma.$disconnect();
  });

  it('exposes the users table', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const count = await prisma.user.count();
    expect(typeof count).toBe('number');
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 11: Run the e2e test**

Run: `pnpm --filter server test:e2e`
Expected: PASS (global setup applies the migration to `idest_test`, both tests pass).

- [ ] **Step 12: Commit**

```bash
git add docker-compose.yml docker/postgres-init.sql apps/server/prisma \
  apps/server/src/prisma apps/server/package.json apps/server/vitest.config.e2e.ts \
  apps/server/test/setup-e2e.ts apps/server/test/prisma.e2e-spec.ts pnpm-lock.yaml
git commit -m "feat(server): add Postgres compose stack and Prisma users layer"
```

---

## Task 3: Clerk backend client provider

**Files:**
- Create: `apps/server/src/auth/clerk-client.provider.ts`
- Test: `apps/server/src/auth/clerk-client.provider.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` from `@nestjs/config`; env key `CLERK_SECRET_KEY`.
- Produces:
  - `const CLERK_CLIENT: symbol` — DI token.
  - `type ClerkClient = ReturnType<typeof createClerkClient>`.
  - `const clerkClientProvider: Provider` — `{ provide: CLERK_CLIENT, inject: [ConfigService], useFactory }`.

- [ ] **Step 1: Write the failing test**

`apps/server/src/auth/clerk-client.provider.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { CLERK_CLIENT, clerkClientProvider } from './clerk-client.provider.js';

describe('clerkClientProvider', () => {
  it('is registered under the CLERK_CLIENT token', () => {
    expect((clerkClientProvider as { provide: symbol }).provide).toBe(CLERK_CLIENT);
  });

  it('builds a Clerk client from CLERK_SECRET_KEY', () => {
    const config = {
      getOrThrow: vi.fn().mockReturnValue('sk_test_123'),
    } as unknown as ConfigService;

    const factory = (
      clerkClientProvider as { useFactory: (c: ConfigService) => unknown }
    ).useFactory;
    const client = factory(config) as { users: unknown };

    expect(config.getOrThrow).toHaveBeenCalledWith('CLERK_SECRET_KEY');
    expect(client.users).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- clerk-client.provider`
Expected: FAIL — cannot find `./clerk-client.provider.js`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/auth/clerk-client.provider.ts`:

```ts
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';

export const CLERK_CLIENT = Symbol('CLERK_CLIENT');

export type ClerkClient = ReturnType<typeof createClerkClient>;

export const clerkClientProvider: Provider = {
  provide: CLERK_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ClerkClient =>
    createClerkClient({
      secretKey: config.getOrThrow<string>('CLERK_SECRET_KEY'),
    }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- clerk-client.provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/clerk-client.provider.ts apps/server/src/auth/clerk-client.provider.spec.ts
git commit -m "feat(server): add Clerk backend client provider"
```

---

## Task 4: Auth decorators + `ClerkAuthGuard`

**Files:**
- Create: `apps/server/src/auth/decorators/public.decorator.ts`
- Create: `apps/server/src/auth/decorators/roles.decorator.ts`
- Create: `apps/server/src/auth/types.ts`
- Create: `apps/server/src/auth/clerk-auth.guard.ts`
- Test: `apps/server/src/auth/clerk-auth.guard.spec.ts`

**Interfaces:**
- Consumes: `Reflector` (`@nestjs/core`), `ConfigService`; `verifyToken` from `@clerk/backend`; env keys `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` (comma-separated origins).
- Produces:
  - `const IS_PUBLIC_KEY = 'isPublic'`; `Public(): MethodDecorator & ClassDecorator`.
  - `const ROLES_KEY = 'roles'`; `Roles(...roles: Role[]): MethodDecorator & ClassDecorator`.
  - `interface RequestAuth { clerkUserId: string; sessionId: string; claims: Record<string, unknown> }`.
  - `class ClerkAuthGuard implements CanActivate` — on success sets `request.auth: RequestAuth`; on failure throws `UnauthorizedException({ error: 'unauthenticated' })`.

- [ ] **Step 1: Write the decorators and shared type**

`apps/server/src/auth/decorators/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
```

`apps/server/src/auth/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import type { Role } from '@repo/auth-contract';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
```

`apps/server/src/auth/types.ts`:

```ts
export interface RequestAuth {
  clerkUserId: string;
  sessionId: string;
  claims: Record<string, unknown>;
}
```

- [ ] **Step 2: Write the failing guard test**

`apps/server/src/auth/clerk-auth.guard.spec.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';

const verifyToken = vi.fn();
vi.mock('@clerk/backend', () => ({ verifyToken: (...a: unknown[]) => verifyToken(...a) }));

import { ClerkAuthGuard } from './clerk-auth.guard.js';

function ctx(headers: Record<string, string>): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ClerkAuthGuard', () => {
  let reflector: Reflector;
  let config: ConfigService;
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    verifyToken.mockReset();
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    config = {
      getOrThrow: vi.fn((k: string) =>
        k === 'CLERK_SECRET_KEY' ? 'sk_test' : 'http://localhost:3000',
      ),
    } as unknown as ConfigService;
    guard = new ClerkAuthGuard(reflector, config);
  });

  it('allows public routes without a token', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { context } = ctx({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const { context } = ctx({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    const { context } = ctx({ authorization: 'Basic abc' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches request.auth on a valid token', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1', org_id: null });
    const { context, request } = ctx({ authorization: 'Bearer good' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual({
      clerkUserId: 'user_1',
      sessionId: 'sess_1',
      claims: { sub: 'user_1', sid: 'sess_1', org_id: null },
    });
    expect(verifyToken).toHaveBeenCalledWith('good', {
      secretKey: 'sk_test',
      authorizedParties: ['http://localhost:3000'],
    });
  });

  it('maps a verifyToken failure to 401', async () => {
    verifyToken.mockRejectedValue(new Error('token expired'));
    const { context } = ctx({ authorization: 'Bearer bad' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server test -- clerk-auth.guard`
Expected: FAIL — cannot find `./clerk-auth.guard.js`.

- [ ] **Step 4: Write the guard**

`apps/server/src/auth/clerk-auth.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import type { RequestAuth } from './types.js';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      auth?: RequestAuth;
    }>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
    const token = header.slice('Bearer '.length);

    try {
      const payload = await verifyToken(token, {
        secretKey: this.config.getOrThrow<string>('CLERK_SECRET_KEY'),
        authorizedParties: this.config
          .getOrThrow<string>('CLERK_AUTHORIZED_PARTIES')
          .split(','),
      });
      request.auth = {
        clerkUserId: payload.sub,
        sessionId: String(payload.sid),
        claims: payload as unknown as Record<string, unknown>,
      };
      return true;
    } catch {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test -- clerk-auth.guard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth/decorators apps/server/src/auth/types.ts \
  apps/server/src/auth/clerk-auth.guard.ts apps/server/src/auth/clerk-auth.guard.spec.ts
git commit -m "feat(server): add auth decorators and ClerkAuthGuard"
```

---

## Task 5: `UserSyncService` (`getOrCreate` + `handleWebhook`) and `@CurrentUser()`

**Files:**
- Create: `apps/server/src/auth/user-sync.service.ts`
- Create: `apps/server/src/auth/decorators/current-user.decorator.ts`
- Test: `apps/server/src/auth/user-sync.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 2); `CLERK_CLIENT` / `ClerkClient` (Task 3); `RequestAuth` (Task 4); `WebhookEvent` from `@clerk/backend`.
- Produces:
  - `class UserSyncService`:
    - `getOrCreate(auth: Pick<RequestAuth, 'clerkUserId'>): Promise<User>`
    - `handleWebhook(evt: WebhookEvent): Promise<void>`
  - `const CurrentUser: ParameterDecorator` — returns `request.localUser as User` (populated by `RolesGuard`, Task 6).

- [ ] **Step 1: Write the `@CurrentUser()` decorator**

`apps/server/src/auth/decorators/current-user.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<{ localUser?: User }>();
    if (!request.localUser) {
      throw new Error('CurrentUser used on a route without RolesGuard');
    }
    return request.localUser;
  },
);
```

- [ ] **Step 2: Write the failing service test**

`apps/server/src/auth/user-sync.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ClerkClient } from './clerk-client.provider.js';
import { UserSyncService } from './user-sync.service.js';

function makePrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  } as unknown as PrismaService & {
    user: Record<'findUnique' | 'create' | 'update' | 'updateMany', ReturnType<typeof vi.fn>>;
  };
}

function makeClerk() {
  return {
    users: { getUser: vi.fn(), updateUserMetadata: vi.fn() },
  } as unknown as ClerkClient & {
    users: Record<'getUser' | 'updateUserMetadata', ReturnType<typeof vi.fn>>;
  };
}

const clerkUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user_new',
  firstName: 'Ada',
  lastName: 'Lovelace',
  primaryEmailAddress: { emailAddress: 'ada@example.com' },
  emailAddresses: [{ emailAddress: 'ada@example.com' }],
  publicMetadata: {},
  ...overrides,
});

describe('UserSyncService.getOrCreate', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let service: UserSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    service = new UserSyncService(prisma, clerk);
  });

  it('returns the existing row when present', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'row_1', clerkUserId: 'user_x' });
    const result = await service.getOrCreate({ clerkUserId: 'user_x' });
    expect(result).toEqual({ id: 'row_1', clerkUserId: 'user_x' });
    expect(clerk.users.getUser).not.toHaveBeenCalled();
  });

  it('creates a teacher by default and mirrors the role into Clerk', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockResolvedValueOnce({ id: 'row_2', role: 'teacher' });

    const result = await service.getOrCreate({ clerkUserId: 'user_new' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        clerkUserId: 'user_new',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        role: 'teacher',
        status: 'active',
        invitedByUserId: null,
      },
    });
    expect(clerk.users.updateUserMetadata).toHaveBeenCalledWith('user_new', {
      publicMetadata: { role: 'teacher' },
    });
    expect(result).toEqual({ id: 'row_2', role: 'teacher' });
  });

  it('creates an invited student linked to the inviting teacher and does not touch Clerk metadata', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null) // by clerkUserId
      .mockResolvedValueOnce({ id: 'teacher_row' }); // inviter lookup
    clerk.users.getUser.mockResolvedValueOnce(
      clerkUser({ publicMetadata: { role: 'student', invitedBy: 'user_teacher' } }),
    );
    prisma.user.create.mockResolvedValueOnce({ id: 'row_3', role: 'student' });

    await service.getOrCreate({ clerkUserId: 'user_new' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'student', invitedByUserId: 'teacher_row' }),
    });
    expect(clerk.users.updateUserMetadata).not.toHaveBeenCalled();
  });

  it('throws 503 when Clerk is unreachable and writes nothing', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.getOrCreate({ clerkUserId: 'user_new' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('recovers from a unique-constraint race by re-reading', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'row_race', clerkUserId: 'user_new' });
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dupe', { code: 'P2002', clientVersion: 'x' }),
    );

    const result = await service.getOrCreate({ clerkUserId: 'user_new' });
    expect(result).toEqual({ id: 'row_race', clerkUserId: 'user_new' });
  });
});

describe('UserSyncService.handleWebhook', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let service: UserSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    service = new UserSyncService(prisma, clerk);
  });

  it('soft-deletes on user.deleted', async () => {
    await service.handleWebhook({ type: 'user.deleted', data: { id: 'user_gone' } } as never);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_gone' },
      data: { status: 'deleted', deletedAt: expect.any(Date) },
    });
  });

  it('updates email and status on user.updated for a known user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'row_u',
      email: 'old@example.com',
      displayName: 'Old',
      role: 'teacher',
      status: 'active',
    });
    await service.handleWebhook({
      type: 'user.updated',
      data: {
        id: 'user_u',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'new@example.com' }],
        first_name: 'New',
        last_name: null,
        public_metadata: {},
        banned: false,
      },
    } as never);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_u' },
      data: { email: 'new@example.com', displayName: 'New', status: 'active' },
    });
  });

  it('promotes role only when public_metadata.role changed', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'row_p',
      email: 'p@example.com',
      displayName: 'P',
      role: 'teacher',
      status: 'active',
    });
    await service.handleWebhook({
      type: 'user.updated',
      data: {
        id: 'user_p',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'p@example.com' }],
        first_name: 'P',
        last_name: null,
        public_metadata: { role: 'admin' },
        banned: false,
      },
    } as never);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_p' },
      data: { email: 'p@example.com', displayName: 'P', status: 'active', role: 'admin' },
    });
  });

  it('creates a row when user.updated arrives for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null); // unknown in handleWebhook
    prisma.user.findUnique.mockResolvedValueOnce(null); // getOrCreate: by clerkUserId
    clerk.users.getUser.mockResolvedValueOnce(clerkUser({ id: 'user_missing' }));
    prisma.user.create.mockResolvedValueOnce({ id: 'row_created' });

    await service.handleWebhook({
      type: 'user.updated',
      data: {
        id: 'user_missing',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'ada@example.com' }],
        first_name: 'Ada',
        last_name: 'Lovelace',
        public_metadata: {},
        banned: false,
      },
    } as never);

    expect(prisma.user.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server test -- user-sync.service`
Expected: FAIL — cannot find `./user-sync.service.js`.

- [ ] **Step 4: Write the service**

`apps/server/src/auth/user-sync.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import type { WebhookEvent } from '@clerk/backend';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLERK_CLIENT, type ClerkClient } from './clerk-client.provider.js';
import type { RequestAuth } from './types.js';
import type { Role } from '@repo/auth-contract';

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
  ) {}

  async getOrCreate(auth: Pick<RequestAuth, 'clerkUserId'>): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { clerkUserId: auth.clerkUserId },
    });
    if (existing) return existing;

    let clerkUser;
    try {
      clerkUser = await this.clerk.users.getUser(auth.clerkUserId);
    } catch (err) {
      this.logger.error(`Clerk getUser failed for ${auth.clerkUserId}`, err as Error);
      throw new ServiceUnavailableException({ error: 'identity_provider_unavailable' });
    }

    const metadata = (clerkUser.publicMetadata ?? {}) as {
      role?: Role;
      invitedBy?: string;
    };
    const roleWasDefaulted = !metadata.role;
    const role: Role = metadata.role ?? 'teacher';

    const email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      '';
    const displayName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
      email.split('@')[0] ||
      auth.clerkUserId;

    let invitedByUserId: string | null = null;
    if (metadata.invitedBy) {
      const inviter = await this.prisma.user.findUnique({
        where: { clerkUserId: metadata.invitedBy },
        select: { id: true },
      });
      invitedByUserId = inviter?.id ?? null;
    }

    let created: User;
    try {
      created = await this.prisma.user.create({
        data: {
          clerkUserId: auth.clerkUserId,
          email,
          displayName,
          role,
          status: 'active',
          invitedByUserId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const row = await this.prisma.user.findUnique({
          where: { clerkUserId: auth.clerkUserId },
        });
        if (row) return row;
      }
      throw err;
    }

    if (roleWasDefaulted) {
      await this.clerk.users.updateUserMetadata(auth.clerkUserId, {
        publicMetadata: { role: 'teacher' },
      });
    }
    // TODO(persistence): emit an audit_events row once that table exists.
    return created;
  }

  async handleWebhook(evt: WebhookEvent): Promise<void> {
    if (evt.type === 'user.deleted') {
      const clerkUserId = evt.data.id;
      if (!clerkUserId) return;
      await this.prisma.user.updateMany({
        where: { clerkUserId },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      return;
    }

    if (evt.type !== 'user.created' && evt.type !== 'user.updated') return;

    const data = evt.data;
    const clerkUserId = data.id;
    const existing = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!existing) {
      await this.getOrCreate({ clerkUserId });
      return;
    }

    const metadata = (data.public_metadata ?? {}) as { role?: Role };
    const email =
      data.email_addresses?.find((e) => e.id === data.primary_email_address_id)
        ?.email_address ??
      data.email_addresses?.[0]?.email_address ??
      '';
    const displayName =
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      email.split('@')[0] ||
      clerkUserId;

    const status =
      existing.status === 'deleted'
        ? 'deleted'
        : data.banned
          ? 'suspended'
          : 'active';

    await this.prisma.user.update({
      where: { clerkUserId },
      data: {
        email: email || existing.email,
        displayName: displayName || existing.displayName,
        status,
        ...(metadata.role && metadata.role !== existing.role
          ? { role: metadata.role }
          : {}),
      },
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test -- user-sync.service`
Expected: PASS (all `getOrCreate` and `handleWebhook` cases green).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth/user-sync.service.ts apps/server/src/auth/user-sync.service.spec.ts \
  apps/server/src/auth/decorators/current-user.decorator.ts
git commit -m "feat(server): add UserSyncService with JIT create and webhook sync"
```

---

## Task 6: `RolesGuard`

**Files:**
- Create: `apps/server/src/auth/roles.guard.ts`
- Test: `apps/server/src/auth/roles.guard.spec.ts`

**Interfaces:**
- Consumes: `Reflector`; `UserSyncService.getOrCreate` (Task 5); `IS_PUBLIC_KEY` (Task 4), `ROLES_KEY` (Task 4); `RequestAuth` (Task 4).
- Produces:
  - `class RolesGuard implements CanActivate`. For non-public routes it always loads the local user via `getOrCreate(request.auth)`, sets `request.localUser: User`, rejects non-`active` status with `ForbiddenException({ error: 'forbidden' })`, and — when `@Roles(...)` is present — rejects a role not in the allowed set with the same 403. Missing `request.auth` → `UnauthorizedException({ error: 'unauthenticated' })`.

- [ ] **Step 1: Write the failing test**

`apps/server/src/auth/roles.guard.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserSyncService } from './user-sync.service.js';
import { RolesGuard } from './roles.guard.js';

function ctx(auth: unknown): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { auth };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let userSync: UserSyncService;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    userSync = { getOrCreate: vi.fn() } as unknown as UserSyncService;
    guard = new RolesGuard(reflector, userSync);
  });

  const publicFalseRolesUndefined = () =>
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'isPublic' ? false : undefined),
    );

  it('bypasses public routes', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => key === 'isPublic',
    );
    const { context } = ctx(undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(userSync.getOrCreate).not.toHaveBeenCalled();
  });

  it('rejects when request.auth is missing', async () => {
    publicFalseRolesUndefined();
    const { context } = ctx(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('loads the user and allows when no @Roles is set and status is active', async () => {
    publicFalseRolesUndefined();
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      role: 'student',
      status: 'active',
    });
    const { context, request } = ctx({ clerkUserId: 'user_1' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.localUser).toEqual({ id: 'u1', role: 'student', status: 'active' });
  });

  it('rejects a suspended user with 403', async () => {
    publicFalseRolesUndefined();
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u2',
      role: 'teacher',
      status: 'suspended',
    });
    const { context } = ctx({ clerkUserId: 'user_2' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a matching role', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'isPublic' ? false : ['teacher']),
    );
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u3',
      role: 'teacher',
      status: 'active',
    });
    const { context } = ctx({ clerkUserId: 'user_3' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a non-matching role with 403', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'isPublic' ? false : ['teacher']),
    );
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u4',
      role: 'student',
      status: 'active',
    });
    const { context } = ctx({ clerkUserId: 'user_4' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- roles.guard`
Expected: FAIL — cannot find `./roles.guard.js`.

- [ ] **Step 3: Write the guard**

`apps/server/src/auth/roles.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Role } from '@repo/auth-contract';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';
import { UserSyncService } from './user-sync.service.js';
import type { RequestAuth } from './types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userSync: UserSyncService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{
      auth?: RequestAuth;
      localUser?: User;
    }>();
    if (!request.auth) {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }

    const user = await this.userSync.getOrCreate(request.auth);
    request.localUser = user;

    if (user.status !== 'active') {
      throw new ForbiddenException({ error: 'forbidden' });
    }
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw new ForbiddenException({ error: 'forbidden' });
    }
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- roles.guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/roles.guard.ts apps/server/src/auth/roles.guard.spec.ts
git commit -m "feat(server): add RolesGuard backed by the local users table"
```

---

## Task 7: `WebhookController`

**Files:**
- Create: `apps/server/src/auth/webhook.controller.ts`
- Test: `apps/server/src/auth/webhook.controller.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (env `CLERK_WEBHOOK_SIGNING_SECRET`); `UserSyncService.handleWebhook` (Task 5); `Webhook` from `svix`; `Public()` (Task 4).
- Produces:
  - `class WebhookController` — `POST /webhooks/clerk`, `@Public()`, `@HttpCode(200)`. Reads `req.rawBody: Buffer`. Invalid svix signature → `BadRequestException({ error: 'invalid_signature' })`. Valid → calls `userSync.handleWebhook(evt)` and returns `{ received: true }`. A thrown `handleWebhook` error propagates (Nest renders 500) so svix retries.

- [ ] **Step 1: Write the failing test**

`apps/server/src/auth/webhook.controller.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Webhook } from 'svix';
import type { ConfigService } from '@nestjs/config';
import type { UserSyncService } from './user-sync.service.js';
import { WebhookController } from './webhook.controller.js';

const SECRET = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function signed(body: object) {
  const payload = JSON.stringify(body);
  const id = 'msg_test';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = new Webhook(SECRET).sign(id, new Date(Number(timestamp) * 1000), payload);
  return {
    rawBody: Buffer.from(payload, 'utf8'),
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    },
  };
}

describe('WebhookController', () => {
  let config: ConfigService;
  let userSync: UserSyncService;
  let controller: WebhookController;

  beforeEach(() => {
    config = { getOrThrow: vi.fn().mockReturnValue(SECRET) } as unknown as ConfigService;
    userSync = { handleWebhook: vi.fn().mockResolvedValue(undefined) } as unknown as UserSyncService;
    controller = new WebhookController(config, userSync);
  });

  it('verifies a valid signature and dispatches the event', async () => {
    const evt = { type: 'user.created', data: { id: 'user_1' } };
    const req = signed(evt);
    await expect(controller.handleClerk(req)).resolves.toEqual({ received: true });
    expect(userSync.handleWebhook).toHaveBeenCalledWith(expect.objectContaining(evt));
  });

  it('rejects a tampered payload with 400', async () => {
    const req = signed({ type: 'user.created', data: { id: 'user_1' } });
    req.rawBody = Buffer.from(req.rawBody.toString('utf8').replace('user_1', 'user_2'), 'utf8');
    await expect(controller.handleClerk(req)).rejects.toBeInstanceOf(BadRequestException);
    expect(userSync.handleWebhook).not.toHaveBeenCalled();
  });

  it('rejects when the signing secret does not match', async () => {
    (config.getOrThrow as ReturnType<typeof vi.fn>).mockReturnValue(
      'whsec_' + Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64'),
    );
    const req = signed({ type: 'user.created', data: { id: 'user_1' } });
    await expect(controller.handleClerk(req)).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- webhook.controller`
Expected: FAIL — cannot find `./webhook.controller.js`.

- [ ] **Step 3: Write the controller**

`apps/server/src/auth/webhook.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import type { WebhookEvent } from '@clerk/backend';
import { Public } from './decorators/public.decorator.js';
import { UserSyncService } from './user-sync.service.js';

interface RawRequest {
  rawBody?: Buffer;
  headers: Record<string, string | undefined>;
}

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly userSync: UserSyncService,
  ) {}

  @Public()
  @Post('clerk')
  @HttpCode(200)
  async handleClerk(@Req() req: RawRequest): Promise<{ received: true }> {
    const secret = this.config.getOrThrow<string>('CLERK_WEBHOOK_SIGNING_SECRET');
    const payload = req.rawBody?.toString('utf8') ?? '';

    let evt: WebhookEvent;
    try {
      evt = new Webhook(secret).verify(payload, {
        'svix-id': req.headers['svix-id'] ?? '',
        'svix-timestamp': req.headers['svix-timestamp'] ?? '',
        'svix-signature': req.headers['svix-signature'] ?? '',
      }) as WebhookEvent;
    } catch {
      throw new BadRequestException({ error: 'invalid_signature' });
    }

    await this.userSync.handleWebhook(evt);
    return { received: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- webhook.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/webhook.controller.ts apps/server/src/auth/webhook.controller.spec.ts
git commit -m "feat(server): add svix-verified Clerk webhook endpoint"
```

---

## Task 8: `InvitationController`

**Files:**
- Create: `apps/server/src/auth/dto/create-invitation.dto.ts`
- Create: `apps/server/src/auth/invitation.controller.ts`
- Test: `apps/server/src/auth/invitation.controller.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (env `APP_URL`); `CLERK_CLIENT` / `ClerkClient` (Task 3); `Roles()` (Task 4); `RequestAuth` (Task 4).
- Produces:
  - `class CreateInvitationDto { email: string }` (`@IsEmail()`).
  - `class InvitationController` — `POST /invitations`, `@Roles('teacher')`. Calls `clerk.invitations.createInvitation` with `publicMetadata: { role: 'student', invitedBy: <caller clerkUserId> }` and `redirectUrl: <APP_URL>/sign-up`. Returns `{ id: string; email: string; status: string }`. A Clerk 422 "already exists" → `ConflictException({ error: 'invitation_exists' })`; any other error rethrows.

- [ ] **Step 1: Write the DTO**

`apps/server/src/auth/dto/create-invitation.dto.ts`:

```ts
import { IsEmail } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;
}
```

- [ ] **Step 2: Write the failing test**

`apps/server/src/auth/invitation.controller.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClerkClient } from './clerk-client.provider.js';
import type { RequestAuth } from './types.js';
import { InvitationController } from './invitation.controller.js';

function makeClerk() {
  return {
    invitations: { createInvitation: vi.fn() },
  } as unknown as ClerkClient & {
    invitations: { createInvitation: ReturnType<typeof vi.fn> };
  };
}

const req = { auth: { clerkUserId: 'user_teacher' } as RequestAuth };

describe('InvitationController', () => {
  let config: ConfigService;
  let clerk: ReturnType<typeof makeClerk>;
  let controller: InvitationController;

  beforeEach(() => {
    config = { getOrThrow: vi.fn().mockReturnValue('http://localhost:3000') } as unknown as ConfigService;
    clerk = makeClerk();
    controller = new InvitationController(config, clerk);
  });

  it('creates a student invitation carrying role and inviter metadata', async () => {
    clerk.invitations.createInvitation.mockResolvedValue({
      id: 'inv_1',
      emailAddress: 'student@example.com',
      status: 'pending',
    });

    const result = await controller.create({ email: 'student@example.com' }, req);

    expect(clerk.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: 'student@example.com',
      publicMetadata: { role: 'student', invitedBy: 'user_teacher' },
      redirectUrl: 'http://localhost:3000/sign-up',
      notify: true,
    });
    expect(result).toEqual({ id: 'inv_1', email: 'student@example.com', status: 'pending' });
  });

  it('maps a Clerk 422 duplicate error to 409', async () => {
    clerk.invitations.createInvitation.mockRejectedValue({
      status: 422,
      errors: [{ code: 'duplicate_record' }],
    });
    await expect(
      controller.create({ email: 'dupe@example.com' }, req),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows unexpected errors', async () => {
    clerk.invitations.createInvitation.mockRejectedValue(new Error('network down'));
    await expect(controller.create({ email: 'x@example.com' }, req)).rejects.toThrow('network down');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server test -- invitation.controller`
Expected: FAIL — cannot find `./invitation.controller.js`.

- [ ] **Step 4: Write the controller**

`apps/server/src/auth/invitation.controller.ts`:

```ts
import {
  Body,
  ConflictException,
  Controller,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Roles } from './decorators/roles.decorator.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { CLERK_CLIENT, type ClerkClient } from './clerk-client.provider.js';
import type { RequestAuth } from './types.js';

function isClerkAlreadyExists(err: unknown): boolean {
  const e = err as { status?: number; errors?: Array<{ code?: string }> };
  return (
    e?.status === 422 &&
    Boolean(
      e.errors?.some(
        (x) => x.code === 'duplicate_record' || x.code === 'form_identifier_exists',
      ),
    )
  );
}

@Controller('invitations')
export class InvitationController {
  constructor(
    private readonly config: ConfigService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
  ) {}

  @Roles('teacher')
  @Post()
  async create(
    @Body() dto: CreateInvitationDto,
    @Req() req: { auth: RequestAuth },
  ): Promise<{ id: string; email: string; status: string }> {
    const appUrl = this.config.getOrThrow<string>('APP_URL');
    try {
      const invitation = await this.clerk.invitations.createInvitation({
        emailAddress: dto.email,
        publicMetadata: { role: 'student', invitedBy: req.auth.clerkUserId },
        redirectUrl: `${appUrl}/sign-up`,
        notify: true,
      });
      return {
        id: invitation.id,
        email: invitation.emailAddress,
        status: invitation.status,
      };
    } catch (err) {
      if (isClerkAlreadyExists(err)) {
        throw new ConflictException({ error: 'invitation_exists' });
      }
      throw err;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test -- invitation.controller`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth/dto apps/server/src/auth/invitation.controller.ts \
  apps/server/src/auth/invitation.controller.spec.ts
git commit -m "feat(server): add teacher-only student invitation endpoint"
```

---

## Task 9: Wire the module, global guards, filter, CORS, `/me`, e2e

**Files:**
- Create: `apps/server/src/auth/auth.controller.ts`
- Create: `apps/server/src/auth/auth.exception-filter.ts`
- Create: `apps/server/src/auth/auth.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/app.controller.ts` (add `@Public()`)
- Test: `apps/server/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–8; `PrismaService` (Task 2).
- Produces:
  - `class AuthController` — `GET /me` returns `@CurrentUser()` (`User`).
  - `class AllExceptionsFilter implements ExceptionFilter` — passes `HttpException` bodies through unchanged; renders anything else as HTTP 500 `{ error: 'internal_error' }` and logs it.
  - `class AuthModule` — imports `ConfigModule`; controllers `WebhookController`, `InvitationController`, `AuthController`; providers + exports `clerkClientProvider`, `UserSyncService`.
  - `AppModule` registers `ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] })`, `PrismaModule`, `AuthModule`, and two `APP_GUARD`s (`ClerkAuthGuard` then `RolesGuard`) plus one `APP_FILTER` (`AllExceptionsFilter`).
  - `main.ts` — `NestFactory.create(AppModule, { rawBody: true })`, global `ValidationPipe({ whitelist: true, transform: true })`, CORS from `CLERK_AUTHORIZED_PARTIES`, `app.listen(3001)` (overridable by `PORT`).

- [ ] **Step 1: Write `AuthController` and the exception filter**

`apps/server/src/auth/auth.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from './decorators/current-user.decorator.js';

@Controller()
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: User): User {
    return user;
  }
}
```

`apps/server/src/auth/auth.exception-filter.ts`:

```ts
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { error: body } : body);
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    response.status(500).json({ error: 'internal_error' });
  }
}
```

- [ ] **Step 2: Write `AuthModule`**

`apps/server/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { clerkClientProvider } from './clerk-client.provider.js';
import { UserSyncService } from './user-sync.service.js';
import { WebhookController } from './webhook.controller.js';
import { InvitationController } from './invitation.controller.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [WebhookController, InvitationController, AuthController],
  providers: [clerkClientProvider, UserSyncService],
  exports: [clerkClientProvider, UserSyncService],
})
export class AuthModule {}
```

- [ ] **Step 3: Rewrite `app.module.ts`**

`apps/server/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClerkAuthGuard } from './auth/clerk-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AllExceptionsFilter } from './auth/auth.exception-filter.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Mark the default route public**

`apps/server/src/app.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
```

- [ ] **Step 5: Rewrite `main.ts`**

`apps/server/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.getOrThrow<string>('CLERK_AUTHORIZED_PARTIES').split(','),
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

await bootstrap();
```

- [ ] **Step 6: Write the failing e2e test**

`apps/server/test/auth.e2e-spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Webhook } from 'svix';
import { AppModule } from '../src/app.module.js';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard.js';
import { CLERK_CLIENT } from '../src/auth/clerk-client.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const WEBHOOK_SECRET =
  'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

// Fake guard: trusts an x-test-user header, shape "<clerkId>".
class FakeClerkAuthGuard {
  canActivate(context: {
    switchToHttp: () => { getRequest: () => Record<string, unknown> };
    getHandler: () => unknown;
    getClass: () => unknown;
  }): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, string | undefined>;
      auth?: unknown;
    };
    const id = req.headers['x-test-user'];
    if (!id) return true; // let RolesGuard/route decide (public routes pass; others 401 later)
    req.auth = { clerkUserId: id, sessionId: 'sess_test', claims: {} };
    return true;
  }
}

const clerkUsers: Record<string, { publicMetadata: Record<string, unknown> }> = {
  user_teacher: { publicMetadata: { role: 'teacher' } },
  user_student: { publicMetadata: { role: 'student' } },
};

const clerkMock = {
  users: {
    getUser: async (id: string) => ({
      id,
      firstName: 'Test',
      lastName: id,
      primaryEmailAddress: { emailAddress: `${id}@example.com` },
      emailAddresses: [{ emailAddress: `${id}@example.com` }],
      publicMetadata: clerkUsers[id]?.publicMetadata ?? {},
    }),
    updateUserMetadata: async () => ({}),
  },
  invitations: {
    createInvitation: async (args: { emailAddress: string }) => ({
      id: 'inv_e2e',
      emailAddress: args.emailAddress,
      status: 'pending',
    }),
  },
};

describe('auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_e2e';
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:3000';
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = WEBHOOK_SECRET;
    process.env.APP_URL = 'http://localhost:3000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useClass(FakeClerkAuthGuard)
      .overrideProvider(CLERK_CLIENT)
      .useValue(clerkMock)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows the public root route without a token', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
  });

  it('rejects GET /me without a token', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('returns the JIT-created user for GET /me with a token', async () => {
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('x-test-user', 'user_teacher')
      .expect(200);
    expect(res.body.role).toBe('teacher');
    expect(res.body.email).toBe('user_teacher@example.com');
  });

  it('forbids a student from POST /invitations', async () => {
    await request(app.getHttpServer())
      .post('/invitations')
      .set('x-test-user', 'user_student')
      .send({ email: 'new-student@example.com' })
      .expect(403);
  });

  it('lets a teacher POST /invitations', async () => {
    const res = await request(app.getHttpServer())
      .post('/invitations')
      .set('x-test-user', 'user_teacher')
      .send({ email: 'new-student@example.com' })
      .expect(201);
    expect(res.body).toEqual({
      id: 'inv_e2e',
      email: 'new-student@example.com',
      status: 'pending',
    });
  });

  it('upserts a user from a signed Clerk webhook', async () => {
    const payload = JSON.stringify({
      type: 'user.created',
      data: {
        id: 'user_webhook',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'hook@example.com' }],
        first_name: 'Hook',
        last_name: null,
        public_metadata: { role: 'student' },
        banned: false,
      },
    });
    const id = 'msg_e2e';
    const timestamp = new Date();
    const signature = new Webhook(WEBHOOK_SECRET).sign(id, timestamp, payload);

    await request(app.getHttpServer())
      .post('/webhooks/clerk')
      .set('svix-id', id)
      .set('svix-timestamp', Math.floor(timestamp.getTime() / 1000).toString())
      .set('svix-signature', signature)
      .set('content-type', 'application/json')
      .send(payload)
      .expect(200);

    const row = await prisma.user.findUnique({ where: { clerkUserId: 'user_webhook' } });
    expect(row?.role).toBe('student');
  });
});
```

- [ ] **Step 7: Ensure `supertest` is available**

Run: `pnpm --filter server add -D supertest @types/supertest`
(Skip if already present — the create-turbo Nest starter usually includes it.)

- [ ] **Step 8: Run unit + e2e suites**

Run: `pnpm --filter server test && pnpm --filter server test:e2e`
Expected: all unit specs PASS; all `auth.e2e-spec.ts` cases PASS (test DB migrated by the global setup from Task 2).

- [ ] **Step 9: Type-check and lint**

Run: `pnpm --filter server lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src pnpm-lock.yaml apps/server/test/auth.e2e-spec.ts apps/server/package.json
git commit -m "feat(server): wire AuthModule, global guards, CORS, /me, e2e coverage"
```

---

## Task 10: Admin seed script

**Files:**
- Create: `apps/server/prisma/seed.ts`
- Create: `apps/server/prisma/promote-to-admin.ts`
- Test: `apps/server/test/promote-to-admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `createClerkClient`.
- Produces:
  - `async function promoteToAdmin(prisma: PrismaClient, clerk: ClerkClient, email: string): Promise<User>` — sets `users.role = 'admin'` by email and mirrors `publicMetadata.role = 'admin'` into Clerk. Throws if no user with that email.

- [ ] **Step 1: Write the failing test**

`apps/server/test/promote-to-admin.e2e-spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { promoteToAdmin } from '../prisma/promote-to-admin.js';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({});
});

describe('promoteToAdmin', () => {
  it('sets role=admin in the database and mirrors it into Clerk', async () => {
    await prisma.user.create({
      data: {
        clerkUserId: 'user_seed',
        email: 'boss@example.com',
        displayName: 'Boss',
        role: 'teacher',
        status: 'active',
      },
    });
    const updateUserMetadata = vi.fn().mockResolvedValue({});
    const clerk = { users: { updateUserMetadata } } as never;

    const updated = await promoteToAdmin(prisma, clerk, 'boss@example.com');

    expect(updated.role).toBe('admin');
    expect(updateUserMetadata).toHaveBeenCalledWith('user_seed', {
      publicMetadata: { role: 'admin' },
    });
  });

  it('throws when the email is unknown', async () => {
    const clerk = { users: { updateUserMetadata: vi.fn() } } as never;
    await expect(promoteToAdmin(prisma, clerk, 'nobody@example.com')).rejects.toThrow(
      /no user/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test:e2e -- promote-to-admin`
Expected: FAIL — cannot find `../prisma/promote-to-admin.js`.

- [ ] **Step 3: Write the helper**

`apps/server/prisma/promote-to-admin.ts`:

```ts
import type { PrismaClient, User } from '@prisma/client';
import type { createClerkClient } from '@clerk/backend';

type ClerkClient = ReturnType<typeof createClerkClient>;

export async function promoteToAdmin(
  prisma: PrismaClient,
  clerk: ClerkClient,
  email: string,
): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    throw new Error(`No user with email ${email}`);
  }
  const updated = await prisma.user.update({
    where: { email },
    data: { role: 'admin' },
  });
  await clerk.users.updateUserMetadata(updated.clerkUserId, {
    publicMetadata: { role: 'admin' },
  });
  return updated;
}
```

- [ ] **Step 4: Write the runnable seed entrypoint**

`apps/server/prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { promoteToAdmin } from './promote-to-admin.js';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? process.argv[2];
  if (!email) {
    throw new Error('Provide the admin email via SEED_ADMIN_EMAIL or the first CLI argument');
  }

  const prisma = new PrismaClient();
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY ?? '',
  });

  const user = await promoteToAdmin(prisma, clerk, email);
  console.log(`Promoted ${email} (${user.id}) to admin.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test:e2e -- promote-to-admin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/prisma/seed.ts apps/server/prisma/promote-to-admin.ts \
  apps/server/test/promote-to-admin.e2e-spec.ts
git commit -m "feat(server): add admin seed script"
```

---

## Task 11: `apps/web` — install Clerk, env plumbing, provider, sign-in/up routes

**Files:**
- Modify: `apps/web/package.json` (deps + `dotenv-cli` script wrappers)
- Modify: `apps/web/app/layout.tsx` (add `<ClerkProvider>` inside `<body>`)
- Create: `apps/web/app/sign-in/[[...sign-in]]/page.tsx`
- Create: `apps/web/app/sign-up/[[...sign-up]]/page.tsx`
- Create: `.env.example` (repo root)
- Modify: `turbo.json` (root)
- Modify: `apps/web/README.md` (webhook + dashboard notes)

**Interfaces:**
- Consumes: `@repo/auth-contract` (Task 1).
- Produces: a `apps/web` that builds and runs with Clerk installed, a `<ClerkProvider>` in the root layout, and `/sign-in` + `/sign-up` routes. Env is loaded from the repo-root `.env`.

- [ ] **Step 1: Install packages**

Run:

```bash
pnpm --filter web add @clerk/nextjs
pnpm --filter web add -D dotenv-cli
pnpm --filter web add @repo/auth-contract@workspace:*
```

- [ ] **Step 2: Run the Clerk CLI initializer, then discard its accountless keys**

Run: `cd apps/web && npx -y clerk@latest init`
Then: `rm -f apps/web/.env.local`

Rationale: Next.js is a supported framework, so `init` provisions an *accountless* app and
writes temporary keys to `apps/web/.env.local`. This project uses real keys in the repo-root
`.env` (loaded via `dotenv-cli` in Step 3), so the generated `.env.local` must be removed or
it will shadow the real publishable key. Keep any `middleware.ts` the CLI created — it is
overwritten in Task 12. Do **not** run `clerk auth login`.

- [ ] **Step 3: Wrap the web scripts with `dotenv-cli`**

Modify `apps/web/package.json` `"scripts"`:

```json
{
  "scripts": {
    "dev": "dotenv -e ../../.env -- next dev --port 3000",
    "build": "dotenv -e ../../.env -- next build",
    "start": "dotenv -e ../../.env -- next start",
    "lint": "eslint --max-warnings 0",
    "check-types": "next typegen && tsc --noEmit"
  }
}
```

- [ ] **Step 4: Add `<ClerkProvider>` to the root layout**

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "IELTS Teacher Assistant",
  description: "Teacher-in-the-loop AI-assisted IELTS Writing assessment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Add the sign-in and sign-up routes**

`apps/web/app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return <SignIn />;
}
```

`apps/web/app/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return <SignUp />;
}
```

- [ ] **Step 6: Add `.env.example` and update `turbo.json`**

`.env.example` (repo root, committed — names only, no values):

```dotenv
# PostgreSQL
DATABASE_URL=postgresql://idest:idest@localhost:5432/idest

# Clerk (from the Clerk dashboard)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SIGNING_SECRET=

# Origins / URLs
CLERK_AUTHORIZED_PARTIES=http://localhost:3000
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001

# Clerk hosted route paths
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

Modify `turbo.json` — add `globalDependencies` and `globalEnv` at the top level (keep the existing `tasks` block):

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "globalDependencies": [".env"],
  "globalEnv": [
    "DATABASE_URL",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SIGNING_SECRET",
    "CLERK_AUTHORIZED_PARTIES",
    "APP_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    "NEXT_PUBLIC_CLERK_SIGN_UP_URL"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**", "!.next/dev/**"]
    },
    "lint": { "dependsOn": ["^lint"] },
    "check-types": { "dependsOn": ["^check-types"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 7: Document the manual Clerk dashboard and webhook steps**

Append to `apps/web/README.md`:

```markdown
## Authentication (Clerk)

Env lives in the repo-root `.env` (see `.env.example`). Web scripts load it via `dotenv-cli`.

### One-time Clerk dashboard setup

1. **Sessions → Customize session token** — add:
   ```json
   { "metadata": "{{user.public_metadata}}" }
   ```
   so `sessionClaims.metadata.role` is available in `middleware.ts`.
2. **Webhooks → Add endpoint** — point it at `<public-url>/webhooks/clerk` on the API
   (port 3001), subscribe to `user.created`, `user.updated`, `user.deleted`, and copy the
   signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`.

### Local webhook development

Expose the API with a tunnel, e.g. `npx untun@latest tunnel http://localhost:3001`, and use
that URL for the webhook endpoint.
```

- [ ] **Step 8: Verify the web app builds and type-checks**

Run: `pnpm --filter web check-types && pnpm --filter web build`
Expected: both succeed. (`build` needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the root `.env`.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json apps/web/app/layout.tsx apps/web/app/sign-in apps/web/app/sign-up \
  apps/web/README.md .env.example turbo.json pnpm-lock.yaml
git commit -m "feat(web): install Clerk, wire provider, sign-in/up routes, root env"
```

---

## Task 12: `apps/web` — middleware, route-access helpers, API helper

**Files:**
- Create: `apps/web/lib/route-access.ts`
- Test: `apps/web/lib/route-access.test.ts`
- Create: `apps/web/lib/api.ts`
- Test: `apps/web/lib/api.test.ts`
- Create: `apps/web/middleware.ts` (overwrites any CLI-generated one)
- Modify: `apps/web/package.json` (add `vitest` + `test` script)

**Interfaces:**
- Consumes: `@repo/auth-contract` `Role` (Task 1); `clerkMiddleware` from `@clerk/nextjs/server`.
- Produces:
  - `function isPublicPath(pathname: string): boolean` — true for `/`, `/sign-in...`, `/sign-up...`.
  - `function roleRedirectTarget(pathname: string, role: Role | undefined): string | null` — `'/'` when a `/teacher*` path is hit by a non-teacher or a `/student*` path by a non-student, else `null`.
  - `async function apiFetch(path: string, token: string | null, init?: RequestInit): Promise<Response>` — prefixes `NEXT_PUBLIC_API_URL`, sets `Authorization: Bearer <token>` when `token` is non-null.
  - `middleware.ts` default export (Clerk middleware) + `config.matcher`.

- [ ] **Step 1: Add Vitest to `apps/web`**

Run: `pnpm --filter web add -D vitest`

Add to `apps/web/package.json` `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing route-access test**

`apps/web/lib/route-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isPublicPath, roleRedirectTarget } from "./route-access";

describe("isPublicPath", () => {
  it("treats the landing page and Clerk routes as public", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-in/factor-one")).toBe(true);
    expect(isPublicPath("/sign-up")).toBe(true);
    expect(isPublicPath("/sign-up/verify-email-address")).toBe(true);
  });

  it("treats everything else as protected", () => {
    expect(isPublicPath("/teacher")).toBe(false);
    expect(isPublicPath("/student/assignments")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
  });
});

describe("roleRedirectTarget", () => {
  it("sends a non-teacher away from /teacher routes", () => {
    expect(roleRedirectTarget("/teacher/queue", "student")).toBe("/");
    expect(roleRedirectTarget("/teacher/queue", undefined)).toBe("/");
  });

  it("sends a non-student away from /student routes", () => {
    expect(roleRedirectTarget("/student/results", "teacher")).toBe("/");
  });

  it("allows the matching role and unscoped routes", () => {
    expect(roleRedirectTarget("/teacher/queue", "teacher")).toBeNull();
    expect(roleRedirectTarget("/student/results", "student")).toBeNull();
    expect(roleRedirectTarget("/dashboard", "teacher")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- route-access`
Expected: FAIL — cannot find `./route-access`.

- [ ] **Step 4: Write `route-access.ts`**

`apps/web/lib/route-access.ts`:

```ts
import type { Role } from "@repo/auth-contract";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/sign-in(?:\/.*)?$/,
  /^\/sign-up(?:\/.*)?$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

export function roleRedirectTarget(
  pathname: string,
  role: Role | undefined,
): string | null {
  if (pathname.startsWith("/teacher") && role !== "teacher") return "/";
  if (pathname.startsWith("/student") && role !== "student") return "/";
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- route-access`
Expected: PASS.

- [ ] **Step 6: Write the failing API-helper test**

`apps/web/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("prefixes NEXT_PUBLIC_API_URL and attaches the bearer token", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = spy as unknown as typeof fetch;

    await apiFetch("/me", "tok_123");

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/me$/);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok_123");
  });

  it("omits the Authorization header when the token is null", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = spy as unknown as typeof fetch;

    await apiFetch("/health", null);

    const [, init] = spy.mock.calls[0];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter web test -- api`
Expected: FAIL — cannot find `./api`.

- [ ] **Step 8: Write `api.ts`**

`apps/web/lib/api.ts` (callers obtain the token per context — server:
`const { getToken } = await auth();` / client: `const { getToken } = useAuth();` — then
`apiFetch("/me", await getToken())`):

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function apiFetch(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_URL}${path}`, { ...init, headers });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter web test -- api`
Expected: PASS.

- [ ] **Step 10: Write `middleware.ts`**

`apps/web/middleware.ts`:

```ts
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Role } from "@repo/auth-contract";
import { isPublicPath, roleRedirectTarget } from "./lib/route-access";

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return;

  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const role = (sessionClaims?.metadata as { role?: Role } | undefined)?.role;
  const target = roleRedirectTarget(pathname, role);
  if (target) {
    return NextResponse.redirect(new URL(target, req.url));
  }
});

export const config = {
  // Clerk's recommended matcher: skip Next internals and static files, always run for API routes.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

- [ ] **Step 11: Type-check, lint, build**

Run: `pnpm --filter web test && pnpm --filter web check-types && pnpm --filter web lint && pnpm --filter web build`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add apps/web/lib apps/web/middleware.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add Clerk middleware, route-access helpers, API helper"
```

---

## Final verification

- [ ] **Step 1: Full workspace check**

Run: `pnpm install && pnpm -r lint && pnpm -r check-types && pnpm -r test`
Expected: all workspaces green.

- [ ] **Step 2: Server e2e**

Run: `docker compose up -d && pnpm --filter server test:e2e`
Expected: PASS.

- [ ] **Step 3: Manual smoke (documented, not automated)**

1. Populate the repo-root `.env` from `.env.example` with real Clerk keys + `DATABASE_URL`.
2. Apply the Clerk dashboard session-token customization (Task 11 Step 7).
3. `docker compose up -d`, then `cd apps/server && pnpm prisma migrate deploy`.
4. `pnpm dev` (Turbo runs web on 3000, server on 3001).
5. Sign up at `/sign-up` → confirm a `users` row appears with `role = 'teacher'` and the
   Clerk user's `publicMetadata.role` is `teacher`.
6. `GET http://localhost:3001/me` with the session token → 200 with the teacher row.
7. `POST http://localhost:3001/invitations` as the teacher → student receives an email;
   after they sign up, a `users` row appears with `role = 'student'` and `invitedByUserId`
   set.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/clerk-auth
```

---

## Follow-ups (tracked, not part of this plan)

- Update the ClickUp `Database Schema` doc: add `clerk_user_id` (unique) and
  `invited_by_user_id` (nullable self-FK) to the `users` table.
- Update the ClickUp `User Roles & Responsibilities` doc: public sign-up creates a teacher;
  students are invitation-only.
- Update `CLAUDE.md` "Working conventions" with the Clerk env keys and the dashboard step.
- Specify FastAPI / RabbitMQ-worker service-to-service authentication (shared secret).
- Replace the `// TODO(persistence)` seam in `UserSyncService` with an `audit_events` write
  once that table lands.
