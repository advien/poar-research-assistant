// =============================================================================
// @opennextjs/cloudflare configuration
//
// Build: `npm run cf:build` produces a Cloudflare Worker bundle.
// Preview: `npm run cf:preview` runs it locally via Wrangler.
// Deploy: `npm run cf:deploy` ships to Cloudflare.
//
// Defaults are intentionally minimal so the project deploys without extra
// Cloudflare bindings. Wire up R2 (incremental cache), KV (tag cache), or
// Durable Objects later by extending this config.
// =============================================================================

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
