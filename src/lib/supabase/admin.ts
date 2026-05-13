import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

/**
 * Service-role client for trusted server-side work that needs to bypass RLS
 * (ingestion pipeline writes, Storage downloads on behalf of a user, etc.).
 * Never import this from client components.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
