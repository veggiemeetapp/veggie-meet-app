import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import AuthCallback from "@/screens/AuthCallback";

const mocks = vi.hoisted(() => ({
  session: null as Session | null,
  listener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: mocks.session }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(
        (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
          mocks.listener = listener;
          return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
        },
      ),
    },
  },
}));

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={["/auth/callback"]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/onboarding" element={<div>Sign-in options</div>} />
        <Route path="/" element={<div>Today home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthCallback", () => {
  beforeEach(() => {
    mocks.session = null;
    mocks.listener = null;
    mocks.unsubscribe.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stays on the neutral restoring surface while auth is unresolved", () => {
    vi.useFakeTimers();
    renderFlow();

    expect(screen.getByTestId("auth-restoring")).toBeTruthy();
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(screen.getByTestId("auth-restoring")).toBeTruthy();
    expect(screen.queryByText("Sign-in options")).toBeNull();
  });

  it("goes directly home when Supabase publishes a session", () => {
    renderFlow();
    const session = { user: { id: "member-1" } } as unknown as Session;

    act(() => mocks.listener?.("SIGNED_IN", session));

    expect(screen.getByText("Today home")).toBeTruthy();
    expect(screen.queryByText("Sign-in options")).toBeNull();
  });

  it("returns to sign-in only after a settled empty initial session", () => {
    renderFlow();

    act(() => mocks.listener?.("INITIAL_SESSION", null));

    expect(screen.getByText("Sign-in options")).toBeTruthy();
  });
});
