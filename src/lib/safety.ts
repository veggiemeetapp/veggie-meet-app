import { supabase } from "@/integrations/supabase/client";

export type PublicReportStatus = "submitted" | "under_review" | "resolved";

export type BlockedProfile = {
  blockId: string;
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
};

export type MyReportRow = {
  reportId: string;
  subjectType: "profile" | "meetup" | "safety_concern";
  subjectId: string | null;
  subjectLabel: string;
  reason: string;
  details: string | null;
  publicStatus: PublicReportStatus;
  createdAt: string;
};

export type MyReportDetail = {
  subjectType: "profile" | "meetup" | "safety_concern";
  reportId: string;
  reason: string;
  details: string | null;
  publicStatus: PublicReportStatus;
  createdAt: string;
  subject: { id: string | null; display_name?: string; avatar_url?: string | null; title?: string; date?: string };
};

/* ------------- Reason taxonomies ------------- */

export const PROFILE_REPORT_REASONS = [
  { id: "harassment", label: "Harassment" },
  { id: "discrimination", label: "Discrimination" },
  { id: "threatening_behavior", label: "Threatening behavior" },
  { id: "inappropriate_content", label: "Inappropriate content" },
  { id: "impersonation", label: "Impersonation" },
  { id: "spam_or_scam", label: "Spam or scam" },
  { id: "safety_concern", label: "Safety concern" },
  { id: "other", label: "Other" },
] as const;

export const MEETUP_REPORT_REASONS = [
  { id: "misleading_information", label: "Misleading information" },
  { id: "unsafe_environment", label: "Unsafe environment" },
  { id: "inappropriate_host_behavior", label: "Inappropriate host behavior" },
  { id: "harassment", label: "Harassment" },
  { id: "discrimination", label: "Discrimination" },
  { id: "cancelled_without_notice", label: "Cancelled without notice" },
  { id: "other", label: "Other" },
] as const;

export const MESSAGE_REPORT_REASONS = [
  { id: "harassment", label: "Harassment" },
  { id: "threatening_message", label: "Threatening message" },
  { id: "sexual_content", label: "Sexual content" },
  { id: "hate_or_discrimination", label: "Hate or discrimination" },
  { id: "spam_or_scam", label: "Spam or scam" },
  { id: "personal_information", label: "Personal information" },
  { id: "other", label: "Other" },
] as const;

export const SAFETY_REASONS = [
  { id: "safety_concern", label: "General safety concern" },
  { id: "harassment", label: "Harassment" },
  { id: "discrimination", label: "Discrimination" },
  { id: "unsafe_environment", label: "Unsafe environment" },
  { id: "other", label: "Other" },
] as const;

export function statusLabel(s: PublicReportStatus): string {
  return s === "submitted" ? "Submitted" : s === "under_review" ? "Under review" : "Resolved";
}

export function reasonLabel(code: string): string {
  const all = [
    ...PROFILE_REPORT_REASONS,
    ...MEETUP_REPORT_REASONS,
    ...MESSAGE_REPORT_REASONS,
    ...SAFETY_REASONS,
  ];
  return all.find((r) => r.id === code)?.label ?? code;
}

/* ------------- Blocks ------------- */

export async function blockProfile(profileId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("block_profile", { _blocked_profile_id: profileId });
  if (error) throw error;
}

export async function unblockProfile(profileId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("unblock_profile", { _blocked_profile_id: profileId });
  if (error) throw error;
}

export async function fetchBlockedProfiles(): Promise<BlockedProfile[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_my_blocked_profiles");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    blockId: r.block_id,
    profileId: r.profile_id,
    displayName: r.display_name ?? "Veggie",
    avatarUrl: r.avatar_url ?? null,
    blockedAt: r.blocked_at,
  }));
}

/* ------------- Reports ------------- */

export async function submitProfileReport(input: {
  reportedProfileId: string;
  reason: string;
  details?: string | null;
  conversationId?: string | null;
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("submit_profile_report", {
    _reported_profile_id: input.reportedProfileId,
    _reason: input.reason,
    _details: input.details ?? null,
    _conversation_id: input.conversationId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function submitMessageReport(input: {
  messageId: string;
  reason: string;
  details?: string | null;
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("submit_dm_message_report", {
    _message_id: input.messageId,
    _reason: input.reason,
    _details: input.details ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function checkVeggieProfileAvailability(
  targetProfileId: string,
): Promise<{ available: boolean; reason?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_veggie_profile_availability",
    { _target_profile_id: targetProfileId },
  );
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? { available: true }) as any;
}

export async function submitSafetyReport(input: {
  reason: string;
  details?: string | null;
  contextMeetupId?: string | null;
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("submit_safety_report", {
    _reason: input.reason,
    _details: input.details ?? null,
    _context_meetup_id: input.contextMeetupId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchMyReports(): Promise<MyReportRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_my_reports");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    reportId: r.report_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    subjectLabel: r.subject_label,
    reason: r.reason,
    details: r.details,
    publicStatus: r.public_status,
    createdAt: r.created_at,
  }));
}

export async function fetchMyReportDetail(subjectType: string, reportId: string): Promise<MyReportDetail> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_my_report_detail", {
    _subject_type: subjectType,
    _report_id: reportId,
  });
  if (error) throw error;
  return data as MyReportDetail;
}
