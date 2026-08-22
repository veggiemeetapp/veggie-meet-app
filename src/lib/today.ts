import { supabase } from "@/integrations/supabase/client";

export type EntityType = "profile" | "meetup" | "place";
export type FeedbackType = "hide" | "see_fewer";

export interface PrimaryAction {
  action_type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  supporting_text?: string | null;
  reason_code: string;
  reason_label: string;
  action_label: string;
  secondary_action_label?: string | null;
  time_context?: string | null;
}

export interface MeetupRecommendation {
  entity_type: "meetup";
  entity_id: string;
  title: string;
  category: string;
  /** WO-126A — canonical Primary interest id. */
  primary_interest_id: string | null;
  additional_interest_ids?: string[] | null;
  date: string;
  start_time: string;
  end_time: string | null;
  cover_image_url: string | null;
  host_id: string;
  attendee_count: number;
  capacity: number;
  is_attending: boolean;
  reason_code: string;
  reason_label: string;
  action_type: "join_meetup" | "view_meetup";
}

export interface VeggieRecommendation {
  entity_type: "profile";
  entity_id: string;
  display_name: string;
  avatar_url: string | null;
  current_city: string | null;
  interests: string[];
  reason_code: string;
  reason_label: string;
  action_type: "view_profile";
}

export interface PlaceRecommendation {
  entity_type: "place";
  entity_id: string;
  name: string;
  category: string;
  address: string;
  cover_image_url: string | null;
  reason_code: string;
  reason_label: string;
  action_type: "view_place";
}

export interface TodayExperience {
  generated_at: string;
  selected_city: string | null;
  primary_action: PrimaryAction | null;
  meetup_recommendations: MeetupRecommendation[];
  veggie_recommendations: VeggieRecommendation[];
  place_recommendations: PlaceRecommendation[];
}

export async function fetchTodayExperience(): Promise<TodayExperience> {
  // Cast RPC name — types are regenerated after migration approval.
  const { data, error } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: unknown; error: Error | null }>)(
    "get_my_today_experience",
  );
  if (error) throw error;
  const t = data as TodayExperience | null;
  return (
    t ?? {
      generated_at: new Date().toISOString(),
      selected_city: null,
      primary_action: null,
      meetup_recommendations: [],
      veggie_recommendations: [],
      place_recommendations: [],
    }
  );
}

export async function hideRecommendation(
  entity_type: EntityType,
  entity_id: string,
  reason_code?: string,
): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: Error | null }>)(
    "hide_today_recommendation",
    { _entity_type: entity_type, _entity_id: entity_id, _reason_code: reason_code ?? null },
  );
  if (error) throw error;
}

export async function seeFewerRecommendations(
  entity_type: EntityType,
  entity_id: string,
  reason_code?: string,
): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: Error | null }>)(
    "see_fewer_today_recommendations",
    { _entity_type: entity_type, _entity_id: entity_id, _reason_code: reason_code ?? null },
  );
  if (error) throw error;
}
