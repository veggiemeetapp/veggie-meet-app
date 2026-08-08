import { supabase } from "@/integrations/supabase/client";

/**
 * WO-072 — canonical member profile mutation surface.
 *
 * Members no longer hold INSERT/UPDATE privileges on `public.profiles`. Every
 * edit is routed through the `update_my_profile` SECURITY DEFINER RPC, which
 * derives the actor from `auth.uid()` and validates each editable field
 * server-side (name trim/length, bio length, interests taxonomy + bounds,
 * avatar URL shape). Private fields — `auth_user_id`, `onboarding_completed`,
 * `community_guidelines_accepted_at`, `is_active_host`, `updated_at` — are not
 * writable through any member-facing path.
 */

// Supabase types are regenerated after migration approval; cast rpc to keep TS green.
type RpcFn = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;

const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      n: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: T | null; error: { message: string } | null }>
  ).call(supabase, name, args);

export interface ProfileEditInput {
  displayName?: string;
  pronouns?: string | null;
  bio?: string;
  /** New hosted avatar URL. Pass `clearAvatar` to remove the photo instead. */
  avatarUrl?: string | null;
  clearAvatar?: boolean;
  interests?: string[];
  dietaryIdentity?: string | null;
}

/** Persist approved editable fields on the caller's own profile. */
export async function updateMyProfile(input: ProfileEditInput): Promise<void> {
  const { error } = await rpc<null>("update_my_profile", {
    _display_name: input.displayName ?? null,
    _pronouns: input.pronouns === undefined ? null : input.pronouns,
    _bio: input.bio ?? null,
    _avatar_url: input.avatarUrl ?? null,
    _clear_avatar: input.clearAvatar ?? false,
    _interests: input.interests ?? null,
    _dietary_identity: input.dietaryIdentity ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Records the community-guidelines acknowledgement. The timestamp is written by
 * the server (`now()`), so it can never be forged or back-dated by a client.
 */
export async function acceptCommunityGuidelines(): Promise<string | null> {
  const { data, error } = await rpc<string>("accept_community_guidelines");
  if (error) throw new Error(error.message);
  return data ?? null;
}
