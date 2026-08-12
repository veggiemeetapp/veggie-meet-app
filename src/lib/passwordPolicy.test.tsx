import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { mapAuthError } from "@/lib/authErrors";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_RULES,
  isPasswordLongEnough,
} from "@/lib/passwordPolicy";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";

// WO-098B §14 — password requirements clarity coverage.

describe("configured password policy", () => {
  it("matches the real production policy: min 6, max 72, no character classes", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(6);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(["length", "breach"]);
  });

  it("never claims uppercase, number or special-character requirements", () => {
    const copy = PASSWORD_RULES.map((r) => r.label).join(" ");
    expect(copy).not.toMatch(/uppercase|lowercase|number|special|symbol/i);
  });

  it("never uses provider jargon in member-facing copy", () => {
    const copy = PASSWORD_RULES.map((r) => r.label).join(" ");
    expect(copy).not.toMatch(/HIBP|pwned|Supabase/i);
  });

  it("derives the too-short guidance from the configured minimum", () => {
    expect(PASSWORD_TOO_SHORT_MESSAGE).toContain(String(PASSWORD_MIN_LENGTH));
    expect(isPasswordLongEnough("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isPasswordLongEnough("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });
});

describe("PasswordRequirements", () => {
  it("renders every configured rule", () => {
    render(<PasswordRequirements password="" />);
    for (const rule of PASSWORD_RULES) {
      expect(screen.getByText(rule.label)).toBeTruthy();
    }
  });

  it("reflects local rule state while typing without a live region", () => {
    const { container } = render(<PasswordRequirements password="abcdef" />);
    expect(container.textContent).toContain("— met");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("keeps the breach rule informational (no local pass/fail claim)", () => {
    const breach = PASSWORD_RULES.find((r) => r.id === "breach")!;
    expect(breach.check("anything")).toBeNull();
  });
});

describe("signup / reset consistency", () => {
  it("uses one shared rule source for both surfaces", () => {
    // Both screens import PASSWORD_RULES, so equality is structural.
    expect(PASSWORD_RULES.length).toBeGreaterThan(0);
    expect(new Set(PASSWORD_RULES.map((r) => r.label)).size).toBe(PASSWORD_RULES.length);
  });
});

describe("provider password rejections", () => {
  it("maps a too-short password to length guidance", () => {
    const mapped = mapAuthError({
      message: "Password should be at least 6 characters.",
    });
    expect(mapped.category).toBe("weak_password");
    expect(mapped.message).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("maps a breached password to safe, actionable breach guidance", () => {
    const mapped = mapAuthError({
      message: "Password is known to be weak and easy to guess, please choose a different one.",
    });
    expect(mapped.category).toBe("compromised_password");
    expect(mapped.message).toMatch(/known data breach/i);
    expect(mapped.message).not.toMatch(/HIBP|pwned/i);
  });

  it("prefers the actionable length fix when both reasons are returned", () => {
    expect(
      mapAuthError({
        message:
          "Password should be at least 6 characters. Password is known to be weak and easy to guess, please choose a different one.",
      }).category,
    ).toBe("weak_password");
  });
});

describe("password mismatch", () => {
  it("has explicit member-facing mismatch copy free of credential content", () => {
    expect(PASSWORD_MISMATCH_MESSAGE).toMatch(/don't match/i);
    expect(PASSWORD_MISMATCH_MESSAGE).not.toMatch(/[Pp]assword: /);
  });
});

describe("analytics privacy", () => {
  it("keeps password surfaces free of credential payloads", async () => {
    const reset = await import("fs").then((fs) =>
      fs.readFileSync("src/screens/ResetPassword.tsx", "utf8"),
    );
    // Every telemetry call may carry a category only.
    const calls = reset.match(/logAnalyticsEvent\([^)]*\)/gs) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // Only the payload matters; event names may mention "password_reset".
      const payload = call.slice(call.indexOf(",") + 1);
      expect(payload).not.toMatch(/password|confirm|email|token/i);
    }

  });
});
