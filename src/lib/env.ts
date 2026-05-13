function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  SUPABASE_URL: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  SUPABASE_ANON_KEY: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  ANTHROPIC_API_KEY: () => required("ANTHROPIC_API_KEY"),
  OPENAI_API_KEY: () => required("OPENAI_API_KEY"),
  APP_URL: () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};
