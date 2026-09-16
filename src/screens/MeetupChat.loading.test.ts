import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/screens/MeetupChat.tsx", "utf8");

describe("Meetup chat loading state", () => {
  it("caches the initial snapshot per chat and signed-in member", () => {
    expect(source).toContain(
      '() => ["meetup-chat", id ?? null, profile?.id ?? null] as const',
    );
    expect(source).toContain("queryKey: chatKey");
    expect(source).toContain("() => chatQuery.data?.context ?? null");
    expect(source).toContain("() => chatQuery.data?.messages ?? []");
    expect(source).toContain('refetchOnMount: "always"');
  });

  it("renders an accessible loader before considering a missing context an error", () => {
    const loadingBranch = source.indexOf("if (isDb && loadingChat)");
    const errorBranch = source.indexOf("if (!isDb || loadError || !context)");

    expect(loadingBranch).toBeGreaterThan(-1);
    expect(errorBranch).toBeGreaterThan(loadingBranch);
    expect(source).toContain('aria-busy="true"');
    expect(source).toContain("<span>Loading chat…</span>");
  });

  it("does not treat an in-flight null context as unavailable", () => {
    expect(source).not.toContain("(!context && !authLoading)");
    expect(source).toContain("chatQuery.isPending || chatQuery.isFetching");
  });

  it("allows a timed-out or failed request to be retried", () => {
    expect(source).toContain("MEETUP_CHAT_TIMEOUT_MESSAGE");
    expect(source).toContain("onClick={() => void chatQuery.refetch()}");
  });
});
