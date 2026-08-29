import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportMeetupDialog } from "./ReportMeetupDialog";
import { MEETUP_REPORT_REASONS } from "@/lib/safety";

/** WO-140 — behavioural contract for the Meetup report dialog. */

const reportMeetup = vi.fn();
vi.mock("@/lib/postMeetup", () => ({
  reportMeetup: (...args: unknown[]) => reportMeetup(...args),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

function setup() {
  const onOpenChange = vi.fn();
  render(<ReportMeetupDialog meetupId="m-1" open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

beforeEach(() => {
  reportMeetup.mockReset();
  reportMeetup.mockResolvedValue("r-1");
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ReportMeetupDialog", () => {
  it("sends the canonical reason code for every reason", async () => {
    setup();
    for (const r of MEETUP_REPORT_REASONS) {
      reportMeetup.mockClear();
      fireEvent.click(screen.getByRole("radio", { name: r.label }));
      fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
      await waitFor(() => expect(reportMeetup).toHaveBeenCalled());
      expect(reportMeetup).toHaveBeenCalledWith("m-1", r.id, null);
    }
  });

  it("trims details and sends null when empty", async () => {
    setup();
    const box = screen.getByLabelText("What happened? (optional)");
    fireEvent.change(box, { target: { value: "   Late host   " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() =>
      expect(reportMeetup).toHaveBeenCalledWith("m-1", "misleading_information", "Late host"),
    );
  });

  it("caps details at 1000 characters", () => {
    setup();
    const box = screen.getByLabelText("What happened? (optional)") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "x".repeat(1200) } });
    expect(box.value).toHaveLength(1000);
    expect(screen.getByText("1000/1000")).toBeTruthy();
  });

  it("closes and confirms on success", async () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("preserves reason and details and shows safe copy on failure", async () => {
    reportMeetup.mockRejectedValue(new Error("Invalid reason"));
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Harassment" }));
    const box = screen.getByLabelText("What happened? (optional)");
    fireEvent.change(box, { target: { value: "Late host" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Please choose a reason from the list and submit again.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByRole("radio", { name: "Harassment" }) as HTMLInputElement).checked).toBe(true);
    expect((box as HTMLTextAreaElement).value).toBe("Late host");
    expect(screen.getByRole("button", { name: "Submit report" })).toBeTruthy();
  });

  it("shows offline copy for a network failure", async () => {
    reportMeetup.mockRejectedValue(new Error("Failed to fetch"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("offline");
    expect(alert.textContent).toContain("Nothing was saved");
  });

  it("cannot double-submit on a rapid double click", async () => {
    let resolve!: (v: string) => void;
    reportMeetup.mockImplementation(() => new Promise((r) => (resolve = r)));
    setup();
    const btn = screen.getByRole("button", { name: "Submit report" });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: "Submitting…" }));
    expect(reportMeetup).toHaveBeenCalledTimes(1);
    resolve("r-1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("submits nothing on Cancel", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(reportMeetup).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits nothing on Escape", () => {
    const { onOpenChange } = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(reportMeetup).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("exposes a labelled radio group and private-report copy", () => {
    setup();
    expect(screen.getByRole("radiogroup").getAttribute("aria-labelledby")).toBe(
      "report-meetup-reason-label",
    );
    expect(screen.getByText(/host is not notified/i)).toBeTruthy();
  });
});
