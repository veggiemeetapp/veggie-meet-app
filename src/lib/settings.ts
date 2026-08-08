import { supabase } from "@/integrations/supabase/client";

export interface SettingsProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  dietary_identity: string | null;
  pronouns: string | null;
  interests: string[];
}

export interface SettingsDiscovery {
  home_city_id: string | null;
  selected_city_id: string | null;
  interests: string[];
}

export interface NotificationPrefs {
  meetup_invitations: boolean;
  meetup_updates: boolean;
  meetup_reminders: boolean;
  messages: boolean;
  connection_requests: boolean;
  connection_accepted: boolean;
  follow_up: boolean;
  community: boolean;
}

export interface SettingsPrivacy {
  discovery_visible: boolean;
  location_permission_result: string | null;
  notification_permission_result: string | null;
}

export interface SettingsAccount {
  email: string | null;
  auth_user_id: string | null;
  community_guidelines_accepted_at: string | null;
}

export interface AccountSettings {
  profile: SettingsProfile;
  discovery: SettingsDiscovery;
  notifications: NotificationPrefs;
  privacy: SettingsPrivacy;
  account: SettingsAccount;
  generated_at: string;
}

type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>)
    .call(supabase, name, args);

export async function fetchMySettings(): Promise<AccountSettings> {
  const { data, error } = await rpc<AccountSettings>("get_my_settings");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Couldn't load settings");
  return data;
}

export async function updateProfileSettings(input: {
  display_name?: string;
  dietary_identity?: string | null;
  pronouns?: string | null;
  bio?: string;
  avatar_url?: string | null;
}) {
  const { error } = await rpc<null>("update_profile_settings", {
    _display_name: input.display_name ?? null,
    _dietary_identity: input.dietary_identity ?? null,
    _pronouns: input.pronouns ?? null,
    _bio: input.bio ?? null,
    _avatar_url: input.avatar_url ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function updateDiscoverySettings(input: {
  home_city_id?: string;
  selected_city_id?: string;
  interests?: string[];
}) {
  const { error } = await rpc<null>("update_discovery_settings", {
    _home_city_id: input.home_city_id ?? null,
    _selected_city_id: input.selected_city_id ?? null,
    _interests: input.interests ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function updateNotificationPreferences(prefs: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const { data, error } = await rpc<NotificationPrefs>("update_notification_preferences", { _prefs: prefs });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Couldn't update preferences");
  return data;
}

export async function updatePrivacySettings(input: { discovery_visible?: boolean }) {
  const { error } = await rpc<null>("update_privacy_settings", {
    _discovery_visible: input.discovery_visible ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface DeletionResult {
  /**
   * WO-074 — `completed` is the normal terminal result (data purged + Auth
   * identity deleted in the same transaction). `already_deleted` is the
   * idempotent repeat result. `blocked` is retained for forward compatibility;
   * the current server flow cancels upcoming hosted Meetups instead of
   * blocking, so it should no longer occur.
   */
  status: "completed" | "already_deleted" | "blocked";
  request_id: string;
  future_hosted_meetup_count: number;
  future_attendance_count: number;
  blockers?: Record<string, unknown>;
}


/**
 * Removes the signed-in user's own avatar objects through the Storage API.
 * The platform rejects direct DELETEs against storage tables from SQL, so this
 * must happen client-side before the deletion RPC runs. Best-effort: a storage
 * failure must never block the account deletion itself.
 */
async function purgeOwnAvatarObjects(): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const { data: files } = await supabase.storage.from("avatars").list(uid, { limit: 100 });
    const paths = (files ?? []).map((f) => `${uid}/${f.name}`);
    if (paths.length) await supabase.storage.from("avatars").remove(paths);
  } catch {
    /* non-fatal */
  }
}

export async function requestAccountDeletion(): Promise<DeletionResult> {
  await purgeOwnAvatarObjects();
  const { data, error } = await rpc<DeletionResult>("request_account_deletion");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Couldn't process deletion");
  return data;
}


export const NOTIFICATION_CATEGORIES: { key: keyof NotificationPrefs; title: string; description: string }[] = [
  { key: "meetup_invitations", title: "Meetup invitations", description: "Personal invites from other Veggies." },
  { key: "meetup_updates", title: "Meetup updates & cancellations", description: "Changes to Meetups you've joined." },
  { key: "meetup_reminders", title: "Meetup reminders", description: "A nudge before your Meetup starts." },
  { key: "messages", title: "Messages", description: "New direct messages." },
  { key: "connection_requests", title: "Connection requests", description: "When someone wants to connect." },
  { key: "connection_accepted", title: "Connection acceptances", description: "When someone accepts your request." },
  { key: "follow_up", title: "Post-Meetup follow-up", description: "Gentle reminders to reflect and reconnect." },
  { key: "community", title: "Community reminders", description: "Occasional community moments." },
];

// Canonical values match the profiles.dietary_identity trigger and the
// onboarding catalogue (WO-037): vegan, vegetarian, plant_based, veg_curious, other.
// "other" carries the "Prefer not to say" label to stay consistent with onboarding copy.
export const DIETARY_OPTIONS = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "plant_based", label: "Plant-based" },
  { value: "veg_curious", label: "Veg-curious" },
  { value: "other", label: "Prefer not to say" },
];

export const PRONOUN_OPTIONS = [
  { value: "she/her", label: "she / her" },
  { value: "he/him", label: "he / him" },
  { value: "they/them", label: "they / them" },
  { value: "she/they", label: "she / they" },
  { value: "he/they", label: "he / they" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
