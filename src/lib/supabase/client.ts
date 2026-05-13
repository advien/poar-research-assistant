"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

// See `server.ts` for the full explanation: @supabase/ssr 0.5.x ships type
// declarations targeting an older 3-generic SupabaseClient. With the installed
// @supabase/supabase-js 2.50+ (5-generic SupabaseClient), the schema object
// gets stuffed into the SchemaName slot and Schema falls back to `never`. We
// force the correct generic instantiation with a single cast.
export function createClient(): SupabaseClient<Database> {
  const client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return client as unknown as SupabaseClient<Database>;
}
