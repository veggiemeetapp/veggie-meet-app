import { supabase } from "@/integrations/supabase/client";
import { isCountryCode } from "@/lib/countries";

/** Countries a member says they have set foot in (honour based, member entered). */
export interface ProfileCountries {
  available: boolean;
  profile_id: string;
  /** ISO alpha-2 codes in the order they were added. */
  codes: string[];
}

type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>).call(supabase, name, args);

function normalize(raw: Partial<ProfileCountries> | null, profileId: string): ProfileCountries {
  const codes = Array.isArray(raw?.codes) ? raw!.codes.filter((c): c is string => typeof c === "string") : [];
  return {
    available: raw?.available === true,
    profile_id: raw?.profile_id ?? profileId,
    // Only codes the client knows count toward n/195; unknown ones are kept out of the UI.
    codes: codes.map((c) => c.toUpperCase()).filter(isCountryCode),
  };
}

export async function fetchProfileCountries(profileId: string): Promise<ProfileCountries> {
  const { data, error } = await rpc<ProfileCountries>("get_profile_countries", { _profile_id: profileId });
  if (error) throw new Error(error.message);
  return normalize(data, profileId);
}

export async function saveMyCountries(codes: string[]): Promise<ProfileCountries> {
  const { data, error } = await rpc<ProfileCountries>("set_my_countries", { _codes: codes });
  if (error) throw new Error(error.message);
  return normalize(data, data?.profile_id ?? "");
}
