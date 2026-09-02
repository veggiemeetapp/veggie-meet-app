import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { PlatformAvatarGallery } from "./PlatformAvatarGallery";
import { PLATFORM_AVATAR_COUNT, platformAvatarToken, resolveAvatar } from "@/lib/avatar";

const assigned = platformAvatarToken(3);

describe("WO-143C PlatformAvatarGallery", () => {
  it("renders every approved avatar and marks the current one", () => {
    render(
      <PlatformAvatarGallery value={null} assignedToken={assigned} onSelect={() => {}} />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(PLATFORM_AVATAR_COUNT);
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect(radios[2].getAttribute("aria-label")).toContain("current");
    expect(radios[2].getAttribute("tabindex")).toBe("0");
    expect(radios[0].getAttribute("tabindex")).toBe("-1");
  });

  it("selects by click and by keyboard, announcing the selection", () => {
    const onSelect = vi.fn();
    render(
      <PlatformAvatarGallery value={assigned} assignedToken={assigned} onSelect={onSelect} />,
    );
    const radios = screen.getAllByRole("radio");

    fireEvent.click(radios[5]);
    expect(onSelect).toHaveBeenLastCalledWith(platformAvatarToken(6));
    expect(screen.getByRole("status").textContent).toContain("avatar 6");

    fireEvent.keyDown(radios[5], { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(platformAvatarToken(7));

    fireEvent.keyDown(radios[6], { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith(platformAvatarToken(6));

    fireEvent.keyDown(radios[5], { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(platformAvatarToken(1));

    fireEvent.keyDown(radios[0], { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(platformAvatarToken(PLATFORM_AVATAR_COUNT));

    fireEvent.keyDown(radios[1], { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith(platformAvatarToken(2));
  });

  it("shows an explicit selection as current instead of the assigned avatar", () => {
    const chosen = platformAvatarToken(7);
    render(
      <PlatformAvatarGallery value={chosen} assignedToken={assigned} onSelect={() => {}} />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[6].getAttribute("aria-checked")).toBe("true");
    expect(radios[2].getAttribute("aria-checked")).toBe("false");
  });

  it("never renders an initial-letter fallback (images only)", () => {
    const { container } = render(
      <PlatformAvatarGallery value={null} assignedToken={assigned} onSelect={() => {}} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(PLATFORM_AVATAR_COUNT);
    expect(container.textContent?.trim()).toBe("");
    // token resolution stays bundled-asset backed
    expect(resolveAvatar(assigned, "x").src).toBeTruthy();
  });
});
