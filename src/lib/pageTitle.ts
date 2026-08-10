/**
 * WO-085 DEF-085-03 (WCAG 2.4.2 Page Titled).
 *
 * Every route previously produced the same document title, so a screen-reader
 * or tab-switching member could not tell which surface they were on. Titles
 * are derived from the *route template only* — never from member, meetup or
 * place content — so nothing private or deleted can leak into browser history
 * or a shared screen.
 */

const SUFFIX = "VeggieMeet";

const EXACT: Record<string, string> = {
  "/": "Today",
  "/onboarding": "Welcome",
  "/community": "Community",
  "/community/places": "Community Places",
  "/community/places/suggest": "Suggest a Community Place",
  "/search": "Search",
  "/host": "Host a Meetup",
  "/chats": "Chats",
  "/you": "You",
  "/you/edit": "Edit profile",
  "/you/places-supported": "Places Supported",
  "/you/place-suggestions": "My place suggestions",
  "/you/place-reports": "My place reports",
  "/plans": "My Plans",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/settings/feedback": "Send beta feedback",
  "/safety": "Safety & Trust",
  "/impact": "Community Impact",
  "/network": "Veggie Network",
};

const PATTERNS: [RegExp, string][] = [
  [/^\/meetup\/[^/]+\/manage$/, "Manage Meetup"],
  [/^\/meetup\/[^/]+\/summary$/, "Meetup summary"],
  [/^\/meetup\/[^/]+$/, "Meetup"],
  [/^\/join\//, "Join Meetup"],
  [/^\/meetup-created\//, "Meetup created"],
  [/^\/group\//, "Meet the group"],
  [/^\/chat\//, "Meetup chat"],
  [/^\/dm\//, "Message"],
  [/^\/checkin\//, "Check in"],
  [/^\/place\/[^/]+\/report$/, "Report a place issue"],
  [/^\/place\//, "Community Place"],
  [/^\/veggie\//, "Veggie profile"],
  [/^\/connection\//, "Verified Connection"],
  [/^\/owner\//, "Owner operations"],
];

/** Route-template-derived document title. Never includes member content. */
export function titleForPath(pathname: string): string {
  const exact = EXACT[pathname.replace(/\/+$/, "") || "/"];
  if (exact) return `${exact} | ${SUFFIX}`;
  for (const [re, label] of PATTERNS) {
    if (re.test(pathname)) return `${label} | ${SUFFIX}`;
  }
  return `Page not found | ${SUFFIX}`;
}
