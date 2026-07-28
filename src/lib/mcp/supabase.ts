import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Build a Supabase client that acts as the signed-in VeggieMeet user.
 * The verified OAuth bearer token is forwarded so RLS runs as that user.
 * Called lazily inside tool handlers so no env is read at import time.
 */
export function supabaseForUser(ctx: ToolContext): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolve the caller's `profiles.id` from their auth user id.
 * Returns null when the profile row hasn't been created yet.
 */
export async function currentProfileId(
  supabase: SupabaseClient,
  _authUserId: string,
): Promise<string | null> {
  // get_my_profile() RPC is scoped to auth.uid() server-side; the caller's
  // authUserId is enforced by the bearer token, not passed as a parameter.
  const { data } = await supabase.rpc("get_my_profile");
  const row = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
  return row?.id ?? null;
}

export function notAuthenticated() {
  return {
    content: [{ type: "text" as const, text: "Not authenticated." }],
    isError: true as const,
  };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}
