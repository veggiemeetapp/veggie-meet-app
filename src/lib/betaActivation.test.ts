import { describe, expect, it } from "vitest";
import {
  activationStages,
  biggestOnboardingDrop,
  eventCount,
  formatRatio,
  isEmptyActivation,
  members,
  ratio,
  updatedLabel,
  type ActivationSummary,
} from "@/lib/betaActivation";

function summary(over: Partial<ActivationSummary> = {}): ActivationSummary {
  return {
    window: "7d",
    window_start: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    product_timezone: "Asia/Ho_Chi_Minh",
    total_events: 0,
    events: {},
    stages: {
      joined: 0,
      reached_today: 0,
      explored_community: 0,
      viewed_place: 0,
      opened_host: 0,
      opened_meet: 0,
      community_action: 0,
    },
    today_and_community_members: 0,
    onboarding_steps: [],
    ...over,
  };
}

describe("WO-097 activation aggregation", () => {
  it("distinguishes unique members from raw event volume", () => {
    // One member firing today_opened 5 times is 1 member, 5 events.
    const s = summary({ events: { today_opened: { members: 1, events: 5 } } });
    expect(members(s, "today_opened")).toBe(1);
    expect(eventCount(s, "today_opened")).toBe(5);
  });

  it("returns 0 for events absent from the window", () => {
    const s = summary();
    expect(members(s, "meetup_created")).toBe(0);
    expect(eventCount(s, "meetup_created")).toBe(0);
  });

  it("derives ordered activation stages from server aggregates", () => {
    const s = summary({
      stages: {
        joined: 10,
        reached_today: 10,
        explored_community: 7,
        viewed_place: 5,
        opened_host: 2,
        opened_meet: 3,
        community_action: 3,
      },
    });
    const stages = activationStages(s);
    expect(stages.map((x) => x.key)).toEqual([
      "joined",
      "reached_today",
      "explored_community",
      "viewed_place",
      "opened_host",
      "opened_meet",
      "community_action",
    ]);
    expect(stages[2].members).toBe(7);
  });

  it("counts a member with several Level-2 actions once", () => {
    // Server dedupes with count(distinct profile_id): three action events from
    // one actor still yields a single community-action member.
    const s = summary({
      events: {
        meetup_created: { members: 1, events: 1 },
        meetup_joined: { members: 1, events: 1 },
        connection_request_sent: { members: 1, events: 1 },
      },
      stages: { ...summary().stages, community_action: 1 },
    });
    expect(activationStages(s).at(-1)?.members).toBe(1);
  });

  it("never produces NaN, Infinity or a fake 100% on a zero denominator", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
    expect(formatRatio(0, 0)).toBe("—");
    expect(formatRatio(5, 0)).toBe("—");
    expect(formatRatio(1, 2)).toBe("50%");
  });

  it("reports the largest onboarding drop only when one truly exists", () => {
    expect(
      biggestOnboardingDrop([
        { step: "identity", members: 5 },
        { step: "dietary", members: 5 },
        { step: "home_city", members: 2 },
      ]),
    ).toEqual({ from: "dietary", to: "home_city", drop: 3 });

    expect(
      biggestOnboardingDrop([
        { step: "identity", members: 0 },
        { step: "dietary", members: 0 },
      ]),
    ).toBeNull();
  });

  it("detects the empty window so the dashboard can stay honest", () => {
    expect(isEmptyActivation(summary())).toBe(true);
    expect(isEmptyActivation(summary({ total_events: 4 }))).toBe(false);
  });

  it("labels staleness truthfully from the server timestamp", () => {
    expect(updatedLabel(new Date().toISOString())).toBe("Updated just now");
    expect(updatedLabel(new Date(Date.now() - 3 * 60_000).toISOString())).toBe(
      "Updated 3 minutes ago",
    );
    expect(updatedLabel(undefined)).toBe("");
  });
});
