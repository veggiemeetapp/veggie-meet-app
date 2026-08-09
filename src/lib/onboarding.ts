import { supabase } from "@/integrations/supabase/client";
import { logAnalyticsEvent } from "@/lib/analytics";

// Supabase types are regenerated after migration approval; cast rpc to keep TS green.
type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>).call(supabase, name, args);

export type OnboardingStep =
  | "welcome"
  | "auth"
  | "identity"
  | "dietary"
  | "home_city"
  | "selected_city"
  | "interests"
  | "photo"
  | "guidelines"
  | "safety"
  | "starting_point"
  | "done";

export const ONBOARDING_STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "auth",
  "identity",
  "dietary",
  "home_city",
  "selected_city",
  "interests",
  "photo",
  "guidelines",
  "safety",
  "starting_point",
  "done",
];

// Steps that show the top progress bar (post-auth input flow).
export const ONBOARDING_PROGRESS_STEPS: OnboardingStep[] = [
  "identity",
  "dietary",
  "home_city",
  "selected_city",
  "interests",
  "photo",
  "guidelines",
  "safety",
  "starting_point",
];

export const MAX_INTERESTS = 8;
export const MIN_INTERESTS = 3;

export interface OnboardingState {
  profile_id: string;
  current_step: string;
  completed_steps: string[];
  skipped_steps: string[];
  started_at: string;
  completed_at: string | null;
  first_meaningful_action_type: string | null;
  first_meaningful_action_entity_id: string | null;
  first_meaningful_action_at: string | null;
  onboarding_version: number;
  updated_at: string;
}

export interface InterestOption {
  id: string;
  label: string;
  category: string | null;
  active: boolean;
  sort_order: number;
}

export type DietaryIdentity =
  | "vegan"
  | "vegetarian"
  | "plant_based"
  | "veg_curious"
  | "other";

export interface StartingPointOption {
  entity_id: string;
  entity_type: "veggie" | "meetup" | "place";
  title: string;
  image: string | null;
  city: string | null;
  reason_code: string;
  reason_label: string;
  action_type: "connect" | "join" | "view";
}

export interface StartingOptions {
  veggie: StartingPointOption | null;
  meetup: StartingPointOption | null;
  place: StartingPointOption | null;
  selected_city_id: string | null;
}

export async function fetchOnboardingState(): Promise<OnboardingState | null> {
  const { data, error } = await rpc<OnboardingState>("get_my_onboarding_state");
  if (error) throw new Error(error.message);
  return data;
}

export async function saveOnboardingStep(step: OnboardingStep, opts?: {
  completed?: boolean;
  skipped?: boolean;
  next?: OnboardingStep;
}): Promise<void> {
  const { error } = await rpc<OnboardingState>("save_onboarding_step", {
    _step: step,
    _completed: opts?.completed ?? true,
    _skipped: opts?.skipped ?? false,
    _next_step: opts?.next ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function completeOnboarding(): Promise<void> {
  const { error } = await rpc<OnboardingState>("complete_onboarding");
  if (error) throw new Error(error.message);
}

export async function recordFirstMeaningfulAction(
  actionType: string,
  entityId: string,
): Promise<void> {
  const { error } = await rpc<OnboardingState>("record_first_meaningful_action", {
    _action_type: actionType,
    _entity_id: entityId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchStartingOptions(): Promise<StartingOptions> {
  const { data, error } = await rpc<StartingOptions>("get_onboarding_starting_options");
  if (error) throw new Error(error.message);
  return data ?? { veggie: null, meetup: null, place: null, selected_city_id: null };
}

export async function fetchInterestCatalogue(): Promise<InterestOption[]> {
  const { data, error } = await supabase
    .from("interest_catalogue" as never)
    .select("id, label, category, active, sort_order")
    .eq("active" as never, true)
    .order("sort_order" as never, { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InterestOption[];
}

/**
 * Fire-and-forget analytics logger. Never throws to callers — onboarding
 * completion must never be blocked by analytics.
 *
 * WO-084: this is a thin alias over the single controlled logger so the event
 * allowlist and payload sanitisation apply to onboarding/settings telemetry too.
 */
export function logOnboardingEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  logAnalyticsEvent(event, properties);
}

export const DIETARY_OPTIONS: Array<{
  id: DietaryIdentity;
  label: string;
  description: string;
  emoji: string;
}> = [
  { id: "vegan",        label: "Vegan",         emoji: "🌱", description: "Fully plant-based lifestyle." },
  { id: "vegetarian",   label: "Vegetarian",    emoji: "🥬", description: "No meat or fish." },
  { id: "plant_based",  label: "Plant-based",   emoji: "🥗", description: "Mostly plants, flexible edges." },
  { id: "veg_curious",  label: "Veg-curious",   emoji: "🌼", description: "Exploring — no labels needed." },
  { id: "other",        label: "Prefer not to say", emoji: "💚", description: "Your identity, your call." },
];
