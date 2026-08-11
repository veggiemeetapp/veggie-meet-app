/**
 * WO-095 DEF-095-01: the app used to read "today" from a hardcoded fixture
 * constant (`TODAY_ISO = "2026-07-02"` in the mock-data file). Every surface
 * that filtered "upcoming" content, labelled a date as "Today", or defaulted
 * the Host date picker was therefore anchored to a fixed past date. Today is
 * now derived from the member's device clock in local time.
 */
export function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
