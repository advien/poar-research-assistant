"use client";

// Route segment config still applies to a "use client" page - Next.js parses
// these exports server-side before turning the rest of the module into a
// client bundle. Required so next-on-pages recognises /login as Edge-runtime.
export const runtime = "edge";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Loader2 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/library";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
      setMessage("Check your inbox for a sign-in link.");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-md bg-primary text-primary-foreground">
            <BookOpen className="h-5 w-5" />
          </div>
          <CardTitle>POAR Research Assistant</CardTitle>
          <CardDescription>
            Prosthetics, orthotics &amp; assistive robotics research workspace. Sign in with a
            one-time email link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state === "sending" || state === "sent"}
            />
            <Button type="submit" className="w-full" disabled={state === "sending" || state === "sent"}>
              {state === "sending" ? "Sending..." : state === "sent" ? "Link sent" : "Send magic link"}
            </Button>
            {message ? (
              <p
                className={
                  state === "error"
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {message}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
