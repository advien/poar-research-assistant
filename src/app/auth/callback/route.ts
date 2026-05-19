import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

/**
 * Magic-link callback. Three outcomes:
 *
 *   1. Code exchange succeeds -> the user gets a fresh session and is sent
 *      to `?next` (defaults to /library).
 *   2. Code exchange fails BUT the user is already signed in (stale link,
 *      duplicate click, expired code with a still-valid cookie) -> we send
 *      them to `?next` anyway. They are authenticated; punishing them with
 *      an error page would be the wrong UX.
 *   3. Code exchange fails AND no existing session -> show the error page so
 *      the user knows to request a fresh link.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/library";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Code missing or exchange failed - check whether the user is already
  // authenticated from a previous session.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
