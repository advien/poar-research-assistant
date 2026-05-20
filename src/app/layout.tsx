import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Library, MessageSquare, Settings, BookOpen, GitCompare, History } from "lucide-react";

const APP_NAME = "POAR Research Assistant";
const APP_DESCRIPTION =
  "AI-powered biomedical research workspace for prosthetics, orthotics, assistive robotics, biomechanics, and rehabilitation engineering literature.";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s - ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [
    "prosthetics",
    "orthotics",
    "assistive robotics",
    "rehabilitation robotics",
    "wearable robotics",
    "biomechatronics",
    "biomechanics",
    "rehabilitation engineering",
    "research assistant",
    "literature review",
    "RAG",
  ],
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        {user ? (
          <header className="border-b">
            <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
              <Link href="/library" className="flex items-center gap-2 font-semibold">
                <BookOpen className="h-5 w-5" />
                POAR Research
              </Link>
              <nav className="flex items-center gap-1">
                <NavLink href="/library" label="Library" icon={<Library className="h-4 w-4" />} />
                <NavLink href="/chat" label="Chat" icon={<MessageSquare className="h-4 w-4" />} />
                <NavLink href="/compare" label="Compare" icon={<GitCompare className="h-4 w-4" />} />
                <NavLink href="/history" label="History" icon={<History className="h-4 w-4" />} />
                <NavLink href="/settings" label="Settings" icon={<Settings className="h-4 w-4" />} />
                <form action="/auth/signout" method="post" className="ml-2">
                  <Button variant="ghost" size="sm" type="submit">
                    Sign out
                  </Button>
                </form>
              </nav>
            </div>
          </header>
        ) : null}
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent"
    >
      {icon}
      {label}
    </Link>
  );
}
