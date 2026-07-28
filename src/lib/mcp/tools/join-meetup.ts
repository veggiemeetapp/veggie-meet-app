import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { currentProfileId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "join_meetup",
  title: "Join a meetup",
  description:
    "Join a VeggieMeet meetup as the signed-in user. Idempotent — joining an already-joined meetup succeeds silently.",
  inputSchema: {
    meetup_id: z.string().describe("The meetup id (UUID) to join."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ meetup_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const profileId = await currentProfileId(supabase, ctx.getUserId());
    if (!profileId) {
      return {
        content: [{ type: "text", text: "No VeggieMeet profile yet — finish onboarding first." }],
        isError: true,
      };
    }

    const { error } = await supabase.rpc("join_meetup", { _meetup_id: meetup_id });
    if (error) {
      return {
        content: [{ type: "text", text: `Could not join: ${error.message}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: "Joined meetup. See you there 🌱" }],
      structuredContent: { meetup_id, status: "joined" },
    };

  },
});
