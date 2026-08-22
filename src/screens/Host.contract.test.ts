import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WO-124F contract guard for the Host create path. The DEF-124F-01 failures
 * came from an out-of-date client whose payload omitted the interest
 * arguments — these assertions keep the current client honest.
 */
const src = readFileSync(resolve(process.cwd(), "src/screens/Host.tsx"), "utf8");

describe("Host create payload contract", () => {
  it("sends both interest arguments to create_hosted_meetup", () => {
    expect(src).toContain('"create_hosted_meetup"');
    expect(src).toContain("_primary_interest_id: primaryInterestId,");
    expect(src).toContain("_additional_interest_ids: additionalInterestIds,");
  });

  it("blocks publish until a Primary interest is selected", () => {
    const guard = src.slice(src.indexOf("const canSubmit ="), src.indexOf("const canSubmit =") + 400);
    expect(guard).toContain("!!primaryInterestId");
    expect(src).toContain("if (!canSubmit");
  });

  it("routes create failures through the single normalization path", () => {
    expect(src).toContain('showErrorToast(e, {');
    expect(src).toContain('surface: "host_create"');
    expect(src).toContain("isStaleClientError(e)");
    // No direct sonner error toast in the create path any more.
    expect(src).not.toContain('toast.error("Couldn\'t create Meetup"');
  });

  it("offers an accessible reload affordance with a warning before reloading", () => {
    expect(src).toContain("altText=");
    expect(src).toContain("window.confirm(");
    expect(src).toContain("window.location.reload()");
  });
});
