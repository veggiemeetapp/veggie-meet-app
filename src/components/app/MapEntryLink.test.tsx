import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MapEntryLink } from "./MapEntryLink";

const access = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/memberMap", () => ({
  fetchMapAccess: () => Promise.resolve(access.value),
}));

function renderEntry() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MapEntryLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WO-154 Map entry point", () => {
  beforeEach(() => {
    access.value = false;
  });

  it("renders nothing for a member without Map access", async () => {
    renderEntry();
    await waitFor(() => expect(screen.queryByLabelText("Open the Map")).toBeNull());
  });

  it("links granted members to /map", async () => {
    access.value = true;
    renderEntry();
    const link = await screen.findByLabelText("Open the Map");
    expect(link.getAttribute("href")).toBe("/map");
  });
});
