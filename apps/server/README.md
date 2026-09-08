# server

The idest API. Built with [NestJS](https://nestjs.com/) (ESM, NodeNext) and Prisma on
PostgreSQL, with [Clerk](https://clerk.com/) for authentication.

## Prerequisites

- Docker (for the local PostgreSQL container)
- pnpm
- Node.js >= 20.9

## Setup

1. **Start PostgreSQL**

   ```bash
   docker compose up -d
   ```

   Runs Postgres 17 on host port **5433** (databases `idest_clerk` and
   `idest_clerk_test`). This does not touch a native Postgres you may already run on
   5432.

2. **Configure environment**

   ```bash
   cp .env.example .env   # at the repo root
   ```

   Fill in the Clerk keys (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_WEBHOOK_SIGNING_SECRET`, `CLERK_AUTHORIZED_PARTIES`) from the Clerk
   dashboard. `DATABASE_URL` already points at the Docker database on 5433.

3. **Install dependencies**

   ```bash
   pnpm install
   ```

4. **Apply migrations** (dev database `idest_clerk`)

   ```bash
   pnpm --filter server exec prisma migrate deploy
   ```

5. **Create the first admin**

   ```bash
   SEED_ADMIN_EMAIL=<email> pnpm --filter server exec prisma db seed
   ```

   The user must already exist in Clerk and have signed in once. The seed promotes
   the matching row to `admin` and mirrors the role into Clerk `publicMetadata`.

## Clerk dashboard (one-time)

- **Sessions -> Customize session token** -- add:

  ```json
  { "metadata": "{{user.public_metadata}}" }
  ```

  so `sessionClaims.metadata.role` is present on every request.

## Running

```bash
pnpm --filter server start:dev     # watch mode, port 3001
```

## Tests

```bash
pnpm --filter server test           # unit
pnpm --filter server test:e2e       # e2e -- needs the Docker DB up;
                                    # globalSetup migrates idest_clerk_test
```

## Local webhook development

Expose the API (port 3001) with a tunnel, e.g.:

```bash
npx untun@latest tunnel http://localhost:3001
```

Register `<tunnel-url>/webhooks/clerk` in the Clerk dashboard (**Webhooks -> Add
endpoint**) and subscribe to `user.created`, `user.updated`, `user.deleted`. Copy
the endpoint's signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`.
