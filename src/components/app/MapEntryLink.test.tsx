import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MapEntryLink } from "./MapEntryLink";

function renderEntry() {
  return render(
    <MemoryRouter>
      <MapEntryLink />
    </MemoryRouter>,
  );
}

describe("Explore Map entry point", () => {
  it("links members to the Explore home", () => {
    renderEntry();
    const link = screen.getByLabelText("Open the Map");
    expect(link.getAttribute("href")).toBe("/");
  });
});
