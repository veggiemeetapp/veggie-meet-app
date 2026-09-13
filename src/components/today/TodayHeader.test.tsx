import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TodayHeader } from "./TodayHeader";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      display_name: "James",
      avatar_url: "/avatar.png",
    },
  }),
}));

vi.mock("@/components/location/CitySelector", () => ({
  CitySelector: () => <div>City selector</div>,
}));

vi.mock("@/components/app", () => ({
  NotificationsBell: () => <div>Notifications</div>,
  UserAvatar: ({ name }: { name: string }) => <div>{name} avatar</div>,
}));

describe("TodayHeader profile avatar", () => {
  it("navigates to the member's profile", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/today"]}>
        <Routes>
          <Route path="/today" element={<TodayHeader />} />
          <Route path="/you" element={<h1>My Profile</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Open my profile" }));

    expect(screen.getByRole("heading", { name: "My Profile" })).toBeInTheDocument();
  });
});
