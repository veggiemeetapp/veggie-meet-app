import { supabase } from "@/integrations/supabase/client";

/** QR payload for a Meetup verification code: `veggiemeet:vfy:v1:<token>` */
const VFY_PREFIX = "veggiemeet:vfy:v1:";

export function encodeVerifyPayload(token: string) {
  return `${VFY_PREFIX}${token}`;
}

export function decodeVerifyPayload(raw: string): string | null {
  if (!raw?.startsWith(VFY_PREFIX)) return null;
  const t = raw.slice(VFY_PREFIX.length).trim();
  return t.length >= 8 ? t : null;
}

export interface IssuedToken {
  token: string;
  expiresAt: string;
}

export async function issueMeetupQrToken(meetupId: string): Promise<IssuedToken> {
  const { data, error } = await supabase.rpc("issue_meetup_qr_token", { _meetup_id: meetupId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : (data as any);
  if (!row?.token) throw new Error("Failed to issue code");
  return { token: row.token as string, expiresAt: row.expires_at as string };
}

export type VerifyResult =
  | { kind: "verified"; peerId: string; meetupId: string }
  | { kind: "already_verified"; peerId: string; meetupId: string }
  | { kind: "error"; code: VerifyErrorCode; message: string };

export type VerifyErrorCode =
  | "invalid"
  | "expired"
  | "self"
  | "not_attendee"
  | "not_connected"
  | "cancelled"
  | "too_early"
  | "closed"
  | "blocked"
  | "unknown";

function classify(message: string): VerifyErrorCode {
  const m = message.toLowerCase();
  if (m.includes("expired")) return "expired";
  if (m.includes("own qr")) return "self";
  if (m.includes("attendee")) return "not_attendee";
  if (m.includes("connected")) return "not_connected";
  if (m.includes("cancelled")) return "cancelled";
  if (m.includes("closer to the meetup")) return "too_early";
  if (m.includes("check-in for this meetup has ended")) return "closed";
  if (m.includes("not available")) return "blocked";
  if (m.includes("invalid")) return "invalid";
  return "unknown";
}

/** Maps the `kind` values returned in the RPC's JSON payload to UI error codes. */
const KIND_TO_CODE: Record<string, VerifyErrorCode> = {
  invalid: "invalid",
  expired: "expired",
  self: "self",
  blocked: "blocked",
  cancelled: "cancelled",
  too_early: "too_early",
  closed: "closed",
  not_attending: "not_attendee",
  not_attendee: "not_attendee",
  not_connected: "not_connected",
};

export async function verifyMeetupConnection(rawScan: string): Promise<VerifyResult> {
  const token = decodeVerifyPayload(rawScan);
  if (!token) return { kind: "error", code: "invalid", message: "That isn't a valid VeggieMeet check-in code." };
  const { data, error } = await supabase.rpc("verify_meetup_connection", { _token: token });
  if (error) {
    return { kind: "error", code: classify(error.message ?? ""), message: error.message ?? "Verification failed" };
  }
  const d = data as any;
  if (d?.kind === "verified" || d?.kind === "already_verified") {
    // The RPC nests peer identity under `peer` — read it from there so the
    // success screen can name the Veggie and link to their profile.
    return {
      kind: d.kind,
      peerId: (d.peer?.id ?? d.peer_id) as string,
      meetupId: (d.meetup_id ?? "") as string,
    };
  }
  const code = KIND_TO_CODE[d?.kind as string] ?? "unknown";
  return { kind: "error", code, message: "Verification failed" };
}

