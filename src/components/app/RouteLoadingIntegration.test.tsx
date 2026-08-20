import { describe, expect, it } from "vitest";
import { lazy, Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RouteLoading } from "./RouteLoading";
import { AppErrorBoundary } from "./ErrorBoundary";

function lazyScreen(text: string, delay = 30) {
  return lazy(
    () =>
      new Promise<{ default: () => JSX.Element }>((resolve) =>
        setTimeout(() => resolve({ default: () => <p>{text}</p> }), delay),
      ),
  );
}

const Slow = lazyScreen("Community screen", 400);
const Fast = lazyScreen("Today screen", 0);
const Broken = lazy(() => Promise.reject(new Error("chunk failed")));

function Harness({ path, element }: { path: string; element: JSX.Element }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <main>
        <AppErrorBoundary>
          <Suspense fallback={<RouteLoading delayMs={0} />}>
            <Routes>
              <Route path={path} element={element} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </main>
    </MemoryRouter>
  );
}

describe("WO-121 shared route suspense boundary", () => {
  it("renders the branded loader instead of a blank main region while pending", () => {
    render(<Harness path="/community" element={<Slow />} />);
    expect(screen.getByTestId("route-loading")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("removes the loader as soon as the destination resolves", async () => {
    render(<Harness path="/" element={<Fast />} />);
    await waitFor(() => expect(screen.getByText("Today screen")).toBeInTheDocument());
    expect(screen.queryByTestId("route-loading")).toBeNull();
  });

  it("lets route load failures reach the error boundary rather than hanging", async () => {
    render(<Harness path="/you" element={<Broken />} />);
    await waitFor(() => expect(screen.queryByTestId("route-loading")).toBeNull());
  });
});
