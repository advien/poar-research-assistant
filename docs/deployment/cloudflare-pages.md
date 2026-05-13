# Cloudflare Pages Deployment

POAR Research Assistant deploys to **Cloudflare Pages / Workers** via the
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) adapter.
Supabase remains the database, auth provider, and Storage backend. Anthropic
and OpenAI are called server-side from the worker.

This guide assumes the canonical production origin is
`https://research.advien.tech`.

---

## 1. One-time install

```bash
npm install --save-dev @opennextjs/cloudflare wrangler
```

`@opennextjs/cloudflare` builds the Next.js app into a Worker bundle.
`wrangler` is the CLI that deploys it.

Login to Cloudflare once:

```bash
npx wrangler login
```

---

## 2. Cloudflare project setup

1. **Create a Worker / Pages project** in the Cloudflare dashboard
   (Workers & Pages -> Create -> Workers).
2. Connect the GitHub repository.
3. Build command: `npm run cf:build`
4. Build output directory: `.open-next`
5. Production branch: `main`
6. Compatibility flags: enable **`nodejs_compat`** (already declared in
   [`wrangler.toml`](../../wrangler.toml)).

`wrangler.toml` is committed at the repo root with the production custom
domain (`research.advien.tech`) and the `NEXT_PUBLIC_APP_URL` public var.

---

## 3. Environment variables & secrets

| Name                              | Where             | Notes                                        |
| --------------------------------- | ----------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | `[vars]`          | Public. Set in Cloudflare dashboard or `wrangler.toml`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | `[vars]`          | Public.                                      |
| `NEXT_PUBLIC_APP_URL`             | `[vars]`          | `https://research.advien.tech` in prod.      |
| `SUPABASE_SERVICE_ROLE_KEY`       | **secret**        | Server-only. Never commit. Used by ingest.   |
| `ANTHROPIC_API_KEY`               | **secret**        | Server-only.                                 |
| `OPENAI_API_KEY`                  | **secret**        | Server-only (embeddings).                    |

Set secrets via Wrangler:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
```

Or paste them into the Cloudflare dashboard under
*Workers & Pages -> your project -> Settings -> Variables*.

---

## 4. Custom domain

In the Cloudflare dashboard:

1. *Workers & Pages -> your project -> Custom domains -> Set up a custom domain*
2. Add `research.advien.tech`.
3. Cloudflare auto-issues a TLS cert and routes traffic. The route is also
   declared in [`wrangler.toml`](../../wrangler.toml) so it stays under code
   review.

---

## 5. Supabase auth redirect configuration

Magic-link sign-in uses `window.location.origin` to build the callback URL,
so the same code works on both localhost and production. You only need to
make Supabase trust both origins.

Open the Supabase dashboard -> *Authentication -> URL Configuration* and set:

- **Site URL**: `https://research.advien.tech`
- **Additional Redirect URLs** (one per line):
  ```
  http://localhost:3000
  http://localhost:3000/auth/callback
  https://research.advien.tech
  https://research.advien.tech/auth/callback
  https://preview.research.advien.tech/auth/callback
  ```

If you skip this step the magic link will refuse to redirect and the user
will land on a Supabase error page.

---

## 6. Database migrations

Migrations live under [`supabase/migrations/`](../../supabase/migrations) and
run against your hosted Supabase project the usual way:

```bash
supabase link --project-ref <ref>
supabase db push
```

There are five migrations: `0001_init`, `0002_storage`, `0003_realtime`,
`0004_chat_history`, `0005_analyses`. They are idempotent and safe to re-run.

---

## 7. Local preview of the production worker

Before deploying:

```bash
npm run cf:build      # build via @opennextjs/cloudflare
npm run cf:preview    # serve via wrangler at http://localhost:8788
```

`cf:preview` reads secrets from a gitignored `.dev.vars` file, so you can
mirror prod configuration locally without touching your `.env.local`:

```bash
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

---

## 8. Deploy

```bash
npm run cf:deploy
```

Or trigger a deploy via a `git push` if the GitHub integration is connected.

---

## 9. Deployment checklist

Before pointing the public domain at the worker:

- [ ] All five Supabase migrations applied to the production project.
- [ ] `papers` storage bucket created (migration 0002 does this).
- [ ] `pgvector` extension enabled in Supabase (migration 0001 enables it).
- [ ] `nodejs_compat` compatibility flag is enabled.
- [ ] All five required env vars / secrets are set in Cloudflare.
- [ ] Supabase **Site URL** points to the production origin.
- [ ] Supabase **Redirect URLs** includes both localhost and production
      `/auth/callback` paths.
- [ ] Run `npm run cf:preview`, sign in, upload a small PDF, run a chat turn,
      generate a structured summary - end-to-end.
- [ ] `npm run check` (lint + typecheck) is green.
- [ ] `npm run build` succeeds.

---

## 10. Known constraints on Cloudflare

- **CPU time per request**: 30 s on the Workers Free plan, 5 min on the Paid
  plan. Ingestion of large PDFs and the comparison generator can exceed 30 s;
  if you stay on Free, lift heavy work into a queue (Cloudflare Queues,
  Inngest, or Trigger.dev).
- **Worker bundle size**: 3 MB compressed on Free, 10 MB on Paid. The current
  bundle ships well under both limits, but adding heavy native deps will not.
- **PDF.js worker**: served from `unpkg.com` by `react-pdf`. For full air-gap
  / CSP control, copy `pdfjs-dist/build/pdf.worker.min.mjs` into `public/` and
  set `pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"` in
  [`PdfViewer.tsx`](../../src/app/papers/[id]/_components/PdfViewer.tsx).
- **Supabase Realtime**: works fine on Workers via the Supabase JS client's
  WebSocket transport. No extra config needed.

---

## 11. Troubleshooting

### Magic link goes to a Supabase error page
The redirect URL is not in the Supabase allow-list. Re-check step 5 - both
the bare origin **and** the `/auth/callback` path must be present, for
**both** localhost and the production domain.

### "Worker exceeded CPU time" on ingestion
You are on the Free plan and the PDF was too large or the embedding batch
was too slow. Options: upgrade to Workers Paid (5 min cap), or split
ingestion into a queue worker (see [roadmap](../roadmap/future-features.md)
on background ingestion).

### `Missing required env var` at runtime
The route reads it lazily via `src/lib/env.ts`. The error names the missing
variable. Set it as a secret with `wrangler secret put` and redeploy.

### `npm run cf:build` fails with "module not found"
Some Node-only packages need the `nodejs_compat` flag. Confirm
[`wrangler.toml`](../../wrangler.toml) has
`compatibility_flags = ["nodejs_compat"]`.

### PDF viewer blank in production
Likely the PDF.js worker fetch is blocked - either the user is on a CSP that
blocks `unpkg.com`, or an ad blocker. Self-host the worker (see constraint
above).

### Realtime sub never fires
Confirm the migration `0003_realtime.sql` applied:
`select * from pg_publication_tables where pubname = 'supabase_realtime';`
should include `papers`.

### 401 on every API call after a deploy
Cookies may be set for the wrong domain. Ensure
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_APP_URL` both reflect production,
not localhost.

### Slow first request after a deploy
Cloudflare cold-starts the worker. Subsequent requests are warm. Use the
Workers KV-backed warm-up trick or hit the worker via a cron ping if
sub-100ms TTFB matters.
