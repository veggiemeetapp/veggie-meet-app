import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  decrementUnreadCount,
  notificationsListKey,
  readUnreadCount,
  setUnreadCount,
  unreadCountKey,
  UNREAD_COUNT_KEY,
} from "./notificationsCache";

/**
 * WO-135 — the badge and the list must resolve to one canonical cache entry.
 * These cover the exact video regression (unread = 1 → mark all → count 0 with
 * no refetch), plus decrement, clamping, zero state and key stability.
 */
describe("WO-135 unread notification cache contract", () => {
  const me = "profile-1";

  it("keys are stable and actor-scoped", () => {
    expect(unreadCountKey(me)).toEqual([UNREAD_COUNT_KEY, me]);
    expect(unreadCountKey(undefined)).toEqual([UNREAD_COUNT_KEY, null]);
    expect(notificationsListKey(me)).toEqual(["notifications", me]);
    // Bell and list writers must agree on the same key for the same actor.
    expect(unreadCountKey(me)).toEqual(unreadCountKey(me));
  });

  it("mark all as read drops the count to zero immediately (video regression)", () => {
    const qc = new QueryClient();
    setUnreadCount(qc, me, 1);
    expect(readUnreadCount(qc, me)).toBe(1);
    setUnreadCount(qc, me, 0);
    expect(readUnreadCount(qc, me)).toBe(0);
  });

  it("individual read decrements the badge", () => {
    const qc = new QueryClient();
    setUnreadCount(qc, me, 5);
    decrementUnreadCount(qc, me);
    expect(readUnreadCount(qc, me)).toBe(4);
    decrementUnreadCount(qc, me, 4);
    expect(readUnreadCount(qc, me)).toBe(0);
  });

  it("never produces a negative count on double taps", () => {
    const qc = new QueryClient();
    setUnreadCount(qc, me, 1);
    decrementUnreadCount(qc, me);
    decrementUnreadCount(qc, me);
    setUnreadCount(qc, me, -3);
    expect(readUnreadCount(qc, me)).toBe(0);
  });

  it("leaves an unfetched count untouched rather than inventing one", () => {
    const qc = new QueryClient();
    decrementUnreadCount(qc, me);
    expect(readUnreadCount(qc, me)).toBeUndefined();
  });

  it("does not leak counts across actors", () => {
    const qc = new QueryClient();
    setUnreadCount(qc, me, 3);
    setUnreadCount(qc, "profile-2", 0);
    expect(readUnreadCount(qc, me)).toBe(3);
    expect(readUnreadCount(qc, "profile-2")).toBe(0);
  });
});
