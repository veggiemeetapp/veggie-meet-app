/**
 * WO-131 — Meetup publish error taxonomy.
 *
 * DEF-131-01: publishing a legitimate Meetup failed with a single generic
 * "Couldn't create Meetup" toast. The server (`public.create_hosted_meetup`)
 * does raise precise, member-safe rules — the client threw them away by
 * overriding the toast title.
 *
 * This module is the one place that:
 *  1. mirrors the authoritative server limits (so the Host form can never
 *     submit a value the backend categorically rejects), and
 *  2. maps a create failure onto a stable application-level code, an optional
 *     form field, and Product-approved copy.
 *
 * The server stays authoritative: everything here is UX, never enforcement.
 * Raw SQLSTATE / Postgres / provider text is never surfaced.
 */

import { normalizeError } from "@/lib/errors";

/* ------------------------------------------------------------------ *
 * Authoritative server limits (mirror of create_hosted_meetup)
 * ------------------------------------------------------------------ */

export const MEETUP_TITLE_MAX = 120;
export const MEETUP_DESCRIPTION_MAX = 2000;
export const MEETUP_CAPACITY_MIN = 1;
export const MEETUP_CAPACITY_MAX = 500;
export const MEETUP_LOCATION_NAME_MAX = 200;
export const MEETUP_ADDRESS_MAX = 300;
/** `char_length(_cover_image_url) > 500000` is rejected server-side. */
export const MEETUP_COVER_MAX_CHARS = 500_000;
/** Kept a little under the server ceiling so re-encoding always lands inside. */
export const MEETUP_COVER_TARGET_CHARS = 460_000;
export const MEETUP_MAX_ADDITIONAL_CATEGORIES = 2;
export const MEETUP_MAX_DAYS_AHEAD = 365;

export type MeetupField =
  | "title"
  | "description"
  | "date"
  | "startTime"
  | "endTime"
  | "capacity"
  | "category"
  | "place"
  | "city"
  | "cover";

export type MeetupPublishErrorCode =
  | "MEETUP_TITLE_REQUIRED"
  | "MEETUP_TITLE_TOO_LONG"
  | "MEETUP_DESCRIPTION_TOO_LONG"
  | "MEETUP_TIME_INVALID"
  | "MEETUP_TIME_PAST"
  | "MEETUP_TIME_TOO_FAR"
  | "MEETUP_CAPACITY_INVALID"
  | "MEETUP_PRIMARY_INTEREST_REQUIRED"
  | "MEETUP_ADDITIONAL_INTERESTS_INVALID"
  | "MEETUP_PLACE_INVALID"
  | "MEETUP_LOCATION_INVALID"
  | "MEETUP_CITY_INVALID"
  | "MEETUP_COVER_TOO_LARGE"
  | "MEETUP_COVER_UPLOAD_FAILED"
  | "MEETUP_PERMISSION_DENIED"
  | "MEETUP_AUTH_EXPIRED"
  | "MEETUP_OFFLINE"
  | "MEETUP_BACKEND_UNAVAILABLE"
  | "MEETUP_DUPLICATE"
  | "MEETUP_STALE_CLIENT"
  | "MEETUP_UNKNOWN";

export interface MeetupPublishError {
  code: MeetupPublishErrorCode;
  /** Form field this error belongs to, when it maps to exactly one. */
  field: MeetupField | null;
  /** Short member-facing headline. */
  title: string;
  /** What to do next. May be empty for field-level errors. */
  description: string;
  /** True when retrying the identical submission could succeed. */
  retryable: boolean;
}

/* ------------------------------------------------------------------ *
 * Client-side pre-publish validation (mirrors the server rules)
 * ------------------------------------------------------------------ */

export interface MeetupDraft {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  cityId: string | null;
  primaryInterestId: string | null;
  additionalInterestIds: string[];
  /** null = Community Place mode with nothing chosen yet. */
  communityPlaceId: string | null;
  isCustomLocation: boolean;
  customName: string;
  customAddress: string;
  coverChars: number;
  /** Local now — injected so tests are deterministic. */
  now?: Date;
}

export interface FieldIssue {
  field: MeetupField;
  code: MeetupPublishErrorCode;
  message: string;
}

/**
 * Every deterministic reason this draft would be rejected. Returned as a full
 * list so the host can fix all of them in one pass instead of discovering them
 * one failed publish at a time.
 */
export function validateMeetupDraft(draft: MeetupDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const title = draft.title.trim();
  const description = draft.description.trim();

  if (title.length === 0) {
    issues.push({
      field: "title",
      code: "MEETUP_TITLE_REQUIRED",
      message: "Add a title so Veggies know what this Meetup is.",
    });
  } else if (title.length > MEETUP_TITLE_MAX) {
    issues.push({
      field: "title",
      code: "MEETUP_TITLE_TOO_LONG",
      message: `Title must be ${MEETUP_TITLE_MAX} characters or fewer (currently ${title.length}).`,
    });
  }

  if (description.length > MEETUP_DESCRIPTION_MAX) {
    issues.push({
      field: "description",
      code: "MEETUP_DESCRIPTION_TOO_LONG",
      message: `Description must be ${MEETUP_DESCRIPTION_MAX} characters or fewer (currently ${description.length}).`,
    });
  }

  if (!draft.primaryInterestId) {
    issues.push({
      field: "category",
      code: "MEETUP_PRIMARY_INTEREST_REQUIRED",
      message: "Choose one Main category.",
    });
  }
  const uniqueAdditional = [
    ...new Set(draft.additionalInterestIds.filter((id) => id && id !== draft.primaryInterestId)),
  ];
  if (uniqueAdditional.length > MEETUP_MAX_ADDITIONAL_CATEGORIES) {
    issues.push({
      field: "category",
      code: "MEETUP_ADDITIONAL_INTERESTS_INVALID",
      message: `Pick at most ${MEETUP_MAX_ADDITIONAL_CATEGORIES} additional categories.`,
    });
  }

  if (!draft.cityId) {
    issues.push({
      field: "city",
      code: "MEETUP_CITY_INVALID",
      message: "Choose the city this Meetup happens in.",
    });
  }

  if (!draft.date || !draft.startTime) {
    issues.push({
      field: !draft.date ? "date" : "startTime",
      code: "MEETUP_TIME_INVALID",
      message: "Choose a date and a start time.",
    });
  } else {
    const start = new Date(`${draft.date}T${draft.startTime}`);
    const now = draft.now ?? new Date();
    if (Number.isNaN(start.getTime())) {
      issues.push({
        field: "date",
        code: "MEETUP_TIME_INVALID",
        message: "Choose a valid date and start time.",
      });
    } else if (start.getTime() < now.getTime()) {
      issues.push({
        field: "date",
        code: "MEETUP_TIME_PAST",
        message: "Choose a future date and time.",
      });
    } else {
      const maxAhead = new Date(now.getTime());
      maxAhead.setDate(maxAhead.getDate() + MEETUP_MAX_DAYS_AHEAD);
      if (start.getTime() > maxAhead.getTime()) {
        issues.push({
          field: "date",
          code: "MEETUP_TIME_TOO_FAR",
          message: "Meetups can only be scheduled up to a year ahead.",
        });
      }
    }
  }

  if (draft.endTime !== "" && draft.endTime <= draft.startTime) {
    issues.push({
      field: "endTime",
      code: "MEETUP_TIME_INVALID",
      message: "End time must be after the start time.",
    });
  }

  const cap = draft.capacity;
  if (
    cap === null ||
    !Number.isFinite(cap) ||
    !Number.isInteger(cap) ||
    cap < MEETUP_CAPACITY_MIN ||
    cap > MEETUP_CAPACITY_MAX
  ) {
    issues.push({
      field: "capacity",
      code: "MEETUP_CAPACITY_INVALID",
      message: `Choose a group size between ${MEETUP_CAPACITY_MIN} and ${MEETUP_CAPACITY_MAX}.`,
    });
  }

  if (draft.isCustomLocation) {
    if (draft.customName.trim().length === 0) {
      issues.push({
        field: "place",
        code: "MEETUP_LOCATION_INVALID",
        message: "Search for the location so Veggies know where to go.",
      });
    } else if (draft.customName.trim().length > MEETUP_LOCATION_NAME_MAX) {
      issues.push({
        field: "place",
        code: "MEETUP_LOCATION_INVALID",
        message: `Location name must be ${MEETUP_LOCATION_NAME_MAX} characters or fewer.`,
      });
    }
    if (draft.customAddress.trim().length === 0) {
      issues.push({
        field: "place",
        code: "MEETUP_LOCATION_INVALID",
        message: "This location needs an address.",
      });
    } else if (draft.customAddress.trim().length > MEETUP_ADDRESS_MAX) {
      issues.push({
        field: "place",
        code: "MEETUP_LOCATION_INVALID",
        message: `Address must be ${MEETUP_ADDRESS_MAX} characters or fewer.`,
      });
    }
  } else if (!draft.communityPlaceId) {
    issues.push({
      field: "place",
      code: "MEETUP_PLACE_INVALID",
      message: "Choose a valid Community Place, or switch to a custom location.",
    });
  }

  if (draft.coverChars > MEETUP_COVER_MAX_CHARS) {
    issues.push({
      field: "cover",
      code: "MEETUP_COVER_TOO_LARGE",
      message: "That cover photo is too large. Choose a smaller image, or publish without one.",
    });
  }

  return issues;
}

/** Human summary for a multi-issue draft, e.g. "Fix 3 things before publishing." */
export function issueSummary(issues: FieldIssue[]): string | null {
  if (issues.length === 0) return null;
  if (issues.length === 1) return issues[0].message;
  return `Fix ${issues.length} things before publishing.`;
}

/* ------------------------------------------------------------------ *
 * Server failure → stable code + member copy
 * ------------------------------------------------------------------ */

/**
 * Ordered rules matched against the message our own RPC raised. Matching our
 * own deliberate `RAISE EXCEPTION` copy is the smallest safe contract: no new
 * SQLSTATEs were introduced, and anything unmatched falls back to the generic
 * (but still useful) publish-level message.
 */
const SERVER_RULES: Array<{
  test: RegExp;
  code: MeetupPublishErrorCode;
  field: MeetupField | null;
  title: string;
  description: string;
}> = [
  {
    test: /cover image is too large/i,
    code: "MEETUP_COVER_TOO_LARGE",
    field: "cover",
    title: "Your cover photo couldn’t be saved",
    description:
      "The image is too large to attach. Choose a smaller photo and try publishing again, or publish without a cover.",
  },
  {
    test: /title is required/i,
    code: "MEETUP_TITLE_REQUIRED",
    field: "title",
    title: "Add a Meetup title",
    description: "Give your Meetup a short title, then publish again.",
  },
  {
    test: /title too long/i,
    code: "MEETUP_TITLE_TOO_LONG",
    field: "title",
    title: "That title is too long",
    description: `Shorten it to ${MEETUP_TITLE_MAX} characters or fewer and try again.`,
  },
  {
    test: /description too long/i,
    code: "MEETUP_DESCRIPTION_TOO_LONG",
    field: "description",
    title: "That description is too long",
    description: `Shorten it to ${MEETUP_DESCRIPTION_MAX} characters or fewer and try again.`,
  },
  {
    test: /main category/i,
    code: "MEETUP_PRIMARY_INTEREST_REQUIRED",
    field: "category",
    title: "Choose one Main category",
    description: "Pick what this Meetup is about, then publish again.",
  },
  {
    test: /additional categor/i,
    code: "MEETUP_ADDITIONAL_INTERESTS_INVALID",
    field: "category",
    title: "Too many additional categories",
    description: `Keep at most ${MEETUP_MAX_ADDITIONAL_CATEGORIES} additional categories and try again.`,
  },
  {
    test: /capacity must be between/i,
    code: "MEETUP_CAPACITY_INVALID",
    field: "capacity",
    title: "That group size isn’t allowed",
    description: `Choose a group size between ${MEETUP_CAPACITY_MIN} and ${MEETUP_CAPACITY_MAX}.`,
  },
  {
    test: /city (is required|unavailable)/i,
    code: "MEETUP_CITY_INVALID",
    field: "city",
    title: "That city isn’t available",
    description: "Choose another city for this Meetup and try again.",
  },
  {
    test: /end time must be after/i,
    code: "MEETUP_TIME_INVALID",
    field: "endTime",
    title: "End time must be after the start time",
    description: "Adjust the times, then publish again.",
  },
  {
    test: /date and (start time are required|time must be in the future)/i,
    code: "MEETUP_TIME_PAST",
    field: "date",
    title: "Choose a future date and time",
    description: "This Meetup’s start time has already passed. Pick a new date and try again.",
  },
  {
    test: /up to a year ahead/i,
    code: "MEETUP_TIME_TOO_FAR",
    field: "date",
    title: "That date is too far ahead",
    description: "Meetups can only be scheduled up to a year ahead.",
  },
  {
    test: /invalid timezone/i,
    code: "MEETUP_CITY_INVALID",
    field: "city",
    title: "We couldn’t work out the time zone",
    description: "Choose the city again, then publish.",
  },
  {
    test: /(place|location).*(unavailable|no longer|not available|maintenance|inactive)|community place/i,
    code: "MEETUP_PLACE_INVALID",
    field: "place",
    title: "That location is no longer available",
    description:
      "We couldn’t publish this Meetup because the selected location is no longer available. Choose another Community Place and try again.",
  },
  {
    test: /(location name|address) (is required|too long)|invalid coordinates|latitude and longitude/i,
    code: "MEETUP_LOCATION_INVALID",
    field: "place",
    title: "We need a complete location",
    description: "Search for the location again so we have its name and address, then publish.",
  },
  {
    test: /can'?t host meetups/i,
    code: "MEETUP_PERMISSION_DENIED",
    field: null,
    title: "This account can’t publish Meetups",
    description: "Your details are still on this screen. Contact support if you think this is wrong.",
  },
  {
    test: /not authenticated/i,
    code: "MEETUP_AUTH_EXPIRED",
    field: null,
    title: "Your session expired",
    description: "Sign in again to publish this Meetup. Nothing was saved.",
  },
];

const FALLBACK: MeetupPublishError = {
  code: "MEETUP_UNKNOWN",
  field: null,
  title: "We couldn’t publish this Meetup",
  description:
    "Your details are still saved on this screen. Please try again. If it keeps happening, contact support.",
  retryable: true,
};

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message ?? "";
  if (error && typeof error === "object") {
    const e = error as { message?: unknown };
    if (typeof e.message === "string") return e.message;
  }
  return "";
}

/**
 * Classify a create failure. Connectivity, session and stale-client cases are
 * delegated to the shared normalizer so a network blip never tells a host to
 * change their Meetup content.
 */
export function classifyMeetupPublishError(error: unknown): MeetupPublishError {
  const normalized = normalizeError(error);

  if (normalized.category === "offline") {
    return {
      code: "MEETUP_OFFLINE",
      field: null,
      title: "Your connection was interrupted",
      description:
        "Check your internet connection and try publishing again. Your details are still on this screen.",
      retryable: true,
    };
  }
  if (normalized.category === "auth_expired") {
    return {
      code: "MEETUP_AUTH_EXPIRED",
      field: null,
      title: "Your session expired",
      description: "Sign in again to publish this Meetup. Nothing was saved.",
      retryable: false,
    };
  }
  if (normalized.category === "stale_client") {
    return {
      code: "MEETUP_STALE_CLIENT",
      field: "category",
      title: normalized.title,
      description: normalized.description,
      retryable: false,
    };
  }
  if (normalized.category === "rate_limited") {
    return {
      code: "MEETUP_BACKEND_UNAVAILABLE",
      field: null,
      title: "Slow down for a moment",
      description: "You’ve tried that a few times. Wait a moment, then publish again.",
      retryable: true,
    };
  }

  const msg = rawMessage(error);
  const rule = SERVER_RULES.find((r) => r.test.test(msg));
  if (rule) {
    return {
      code: rule.code,
      field: rule.field,
      title: rule.title,
      description: rule.description,
      retryable: false,
    };
  }

  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status === 403) {
    return {
      code: "MEETUP_PERMISSION_DENIED",
      field: null,
      title: "You don’t have permission to publish this Meetup",
      description: "Your details are still on this screen. Contact support if this looks wrong.",
      retryable: false,
    };
  }
  if (typeof status === "number" && status >= 500) {
    return {
      code: "MEETUP_BACKEND_UNAVAILABLE",
      field: null,
      title: "VeggieMeet couldn’t reach the server",
      description:
        "Your details are still saved on this screen. Please try publishing again in a moment.",
      retryable: true,
    };
  }

  return FALLBACK;
}

/** Bounded, non-PII diagnostic payload for publish-failure analytics. */
export function publishFailureAnalytics(
  err: MeetupPublishError,
  stage: "validation" | "rpc" | "cover",
) {
  return {
    error_code: err.code,
    stage,
    field: err.field ?? "none",
    retryable: err.retryable,
  };
}
