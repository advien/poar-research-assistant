/**
 * Global Vitest setup. Runs once before any tests.
 *
 * The codebase is a Next.js + Supabase + AI SDK app. Tests are pure unit /
 * integration-style tests against the library code; they NEVER hit Supabase or
 * any AI provider for real. Fakes / mocks are constructed per-test.
 *
 * We still seed the bare-minimum env vars so any module that lazily reads
 * `process.env.*` at import time does not throw under Vitest.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

// NODE_ENV is read-only in @types/node, but Vitest already sets it to "test"
// for us so we don't need to assign here.
