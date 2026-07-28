import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingMeetups from "./tools/list-upcoming-meetups";
import getMeetup from "./tools/get-meetup";
import listMyMeetups from "./tools/list-my-meetups";
import joinMeetup from "./tools/join-meetup";
import listMyConnections from "./tools/list-my-connections";
import getMyProfile from "./tools/get-my-profile";

// The OAuth issuer must be the direct Supabase host, built from the project
// ref (Vite inlines this literal at build time so the entry stays import-safe).
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "veggiemeet-mcp",
  title: "VeggieMeet",
  version: "0.1.0",
  instructions:
    "Tools for VeggieMeet — a community for plant-based people to meet up in real life. Use these tools to browse upcoming meetups, look up meetup details, see the signed-in user's hosted and joined meetups, join meetups, and list their Veggie Network connections. All actions run as the signed-in VeggieMeet user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listUpcomingMeetups,
    getMeetup,
    listMyMeetups,
    joinMeetup,
    listMyConnections,
    getMyProfile,
  ],
});
