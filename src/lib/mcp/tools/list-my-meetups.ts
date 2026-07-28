import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { currentProfileId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_meetups",
  title: "List my meetups",
  description:
    "List the meetups the signed-in VeggieMeet user is hosting or attending.",
  inputSchema: {
    role: z
      .enum(["hosting", "attending", "all"])
      .optional()
      .describe("Filter by role. Defaults to 'all'."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ role }, ctx) => {
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
    const r = role ?? "all";
    const { data: attendance } = await supabase
      .from("attendance")
      .select("meetup_id, status, meetups(*)")
      .eq("profile_id", profileId);

    const rows = (attendance ?? [])
      .map((a: Record<string, unknown>) => a.meetups as Record<string, unknown>)
      .filter(Boolean)
      .filter((m) => {
        if (r === "hosting") return m.host_id === profileId;
        if (r === "attending") return m.host_id !== profileId;
        return true;
      });

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { meetups: rows },
    };
  },
});
