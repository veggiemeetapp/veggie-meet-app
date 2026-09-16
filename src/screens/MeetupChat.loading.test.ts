import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/screens/MeetupChat.tsx", "utf8");

describe("Meetup chat loading state", () => {
  it("tracks the chat request independently from auth hydration", () => {
    expect(source).toContain("const [loadingChat, setLoadingChat] = useState(true)");
    expect(source).toContain("setLoadingChat(true)");
    expect(source).toContain("if (!cancelled) setLoadingChat(false)");
  });

  it("renders an accessible loader before considering a missing context an error", () => {
    const loadingBranch = source.indexOf("if (isDb && (authLoading || loadingChat))");
    const errorBranch = source.indexOf("if (!isDb || loadError || !context)");

    expect(loadingBranch).toBeGreaterThan(-1);
    expect(errorBranch).toBeGreaterThan(loadingBranch);
    expect(source).toContain('aria-busy="true"');
    expect(source).toContain("<span>Loading chat…</span>");
  });

  it("does not treat an in-flight null context as unavailable", () => {
    expect(source).not.toContain("(!context && !authLoading)");
  });
});
