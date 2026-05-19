import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/library" : "/login");
}
