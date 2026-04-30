/**
 * Validate the env vars Plank requires to start. Call once at process
 * boot — failures throw a single readable error instead of N confusing
 * "Invalid URL" or undefined-deref errors deep in the request path.
 */
export function loadConfig() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Did you copy .env.example to .env?`
    );
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}
