import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/screens/Onboarding.tsx"), "utf8");
const guidelinesStart = source.indexOf("function Guidelines({");
const guidelines = source.slice(
  guidelinesStart,
  source.indexOf("\nfunction Safety(", guidelinesStart),
);

describe("compact Community Promise step", () => {
  it("constrains only the guidelines step to one dynamic viewport", () => {
    expect(source).toContain(
      'step === "guidelines" ? "h-dvh overflow-hidden" : "min-h-dvh"',
    );
    expect(source).toContain('className="flex-1 min-h-0 flex flex-col"');
  });

  it("uses the compact spacing needed to keep the acknowledgement visible", () => {
    expect(guidelines).toContain('className="flex-1 min-h-0 flex flex-col page-x pt-2 pb-3');
    expect(guidelines).toContain('className="space-y-2 flex-1 min-h-0"');
    expect(guidelines).toContain('className={cn("mt-2"');
  });
});
