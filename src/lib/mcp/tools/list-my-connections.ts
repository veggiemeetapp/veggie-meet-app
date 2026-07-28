import { defineTool } from "@lovable.dev/mcp-js";
import { currentProfileId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_connections",
  title: "List my Veggie Network",
  description:
    "List the signed-in user's confirmed VeggieMeet connections (their Veggie Network).",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const me = await currentProfileId(supabase, ctx.getUserId());
    if (!me) {
      return {
        content: [{ type: "text", text: "No VeggieMeet profile yet." }],
        isError: true,
      };
    }
    const { data, error } = await supabase
      .from("friendships")
      .select(
        "profile_a_id, profile_b_id, friends_since, status, first_meetup_id",
      )
      .or(`profile_a_id.eq.${me},profile_b_id.eq.${me}`);
    if (error) {
      return {
        content: [{ type: "text", text: `Failed: ${error.message}` }],
        isError: true,
      };
    }

    const otherIds = (data ?? []).map((f) =>
      f.profile_a_id === me ? f.profile_b_id : f.profile_a_id,
    );
    const { data: profiles } = otherIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name, current_city")
          .in("id", otherIds)
      : { data: [] as Array<Record<string, unknown>> };

    const rows = (data ?? []).map((f) => {
      const other = f.profile_a_id === me ? f.profile_b_id : f.profile_a_id;
      const p = (profiles ?? []).find((x) => x.id === other);
      return {
        connection: p ?? { id: other },
        friends_since: f.friends_since,
        status: f.status,
        first_meetup_id: f.first_meetup_id,
      };
    });

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { connections: rows },
    };
  },
});
