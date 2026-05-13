import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * NOTE: `@supabase/ssr@0.5.x` declares its return type as
 * `SupabaseClient<Database, SchemaName, Schema>` (3 generics), but
 * `@supabase/supabase-js@2.50+` reorganised `SupabaseClient` to take 5
 * generics where position 3 is `SchemaName` (a string). The mismatch causes
 * TypeScript to put the schema OBJECT into the `SchemaName` slot, fail the
 * constraint, and resolve `Schema` to `never` - which then makes every
 * `.from()`, `.update()`, `.insert()`, and `.rpc()` call typecheck against
 * `never`.
 *
 * We force the correct generic instantiation with a single cast here. With
 * only `Database` provided, supabase-js's default generics correctly evaluate
 * Schema = Database['public'] (which now satisfies GenericSchema thanks to
 * the `Indexed<T>` intersections in `src/types/db.ts`).
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component during render; safe to ignore.
          }
        },
      },
    }
  );
  return client as unknown as SupabaseClient<Database>;
}

export async function getUserOrThrow() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("UNAUTHENTICATED");
  return { supabase, user: data.user };
}

/**
 * The exact Supabase client type returned by `createClient()`.
 *
 * We deliberately derive it from `createClient` instead of using
 * `SupabaseClient<Database>` because @supabase/ssr and @supabase/supabase-js
 * do not always agree on how the client's internal Schema generic slots are
 * filled, and an explicit `SupabaseClient<Database>` annotation expands to a
 * different generic shape than what `createServerClient<Database>` returns.
 *
 * Helpers that need a typed client should `import type { SupabaseDbClient }`
 * from this module so they are guaranteed to match the call site.
 */
export type SupabaseDbClient = Awaited<ReturnType<typeof createClient>>;
