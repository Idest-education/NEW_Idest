This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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
