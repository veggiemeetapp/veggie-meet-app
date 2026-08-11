import { describe, expect, it } from "vitest";
import { mapAuthError, redactAuthUrl } from "@/lib/authErrors";
import { sanitizeInternalPath } from "@/lib/authRedirect";

// WO-098 §66 — focused auth regression coverage.

describe("mapAuthError", () => {
  it("maps invalid credentials to member-safe copy without provider text", () => {
    const mapped = mapAuthError({ message: "Invalid login credentials" });
    expect(mapped.category).toBe("invalid_credentials");
    expect(mapped.message).not.toMatch(/invalid login credentials/i);
  });

  it("maps unconfirmed email to a recoverable state", () => {
    expect(mapAuthError({ message: "Email not confirmed" }).category).toBe(
      "email_not_confirmed",
    );
  });

  it("maps expired confirmation and recovery links", () => {
    expect(mapAuthError({ message: "Token has expired or is invalid" }).category).toBe(
      "link_expired",
    );
  });

  it("maps rate limiting", () => {
    expect(mapAuthError({ message: "over_email_send_rate_limit" }).category).toBe(
      "rate_limited",
    );
  });

  it("maps HIBP compromised-password rejection", () => {
    expect(
      mapAuthError({ message: "This password has been found in a data breach" }).category,
    ).toBe("compromised_password");
  });

  it("never leaks an unknown provider payload", () => {
    const mapped = mapAuthError({
      message: "AuthApiError: 500 {\"trace\":\"pg: relation profiles\"}",
    });
    expect(mapped.category).toBe("unknown");
    expect(mapped.message).not.toMatch(/AuthApiError|pg:|trace/);
  });
});

describe("redactAuthUrl", () => {
  it("drops token-bearing query and hash fragments", () => {
    const redacted = redactAuthUrl(
      "https://veggie-meet-app.lovable.app/reset-password?token=abc123#access_token=secret&type=recovery",
    );
    expect(redacted).toBe("/reset-password");
    expect(redacted).not.toMatch(/abc123|secret|access_token/);
  });
});

describe("sanitizeInternalPath (auth return URL)", () => {
  it("accepts internal paths", () => {
    expect(sanitizeInternalPath("/network")).toBe("/network");
  });

  it("rejects external and protocol-relative destinations", () => {
    for (const hostile of [
      "https://evil.test/steal",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
    ]) {
      expect(sanitizeInternalPath(hostile)).toBeNull();
    }
  });
});
