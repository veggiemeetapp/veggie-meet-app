import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_meetup",
  title: "Get meetup details",
  description:
    "Get a single VeggieMeet meetup by id, including host, location, capacity, and current attendee count.",
  inputSchema: {
    meetup_id: z.string().describe("The meetup id (UUID)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ meetup_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("meetups")
      .select(
        "id, title, description, category, date, start_time, end_time, capacity, status, custom_location_name, custom_location_address, host_id",
      )
      .eq("id", meetup_id)
      .maybeSingle();
    if (error || !data) {
      return {
        content: [
          { type: "text", text: `Meetup not found or not visible.` },
        ],
        isError: true,
      };
    }
    const { count } = await supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("meetup_id", meetup_id)
      .eq("status", "joined");
    const [host] = (
      await supabase
        .from("profiles")
        .select("id, display_name, current_city")
        .eq("id", data.host_id)
        .limit(1)
    ).data ?? [];

    const result = {
      ...data,
      attendee_count: count ?? 0,
      host: host ?? null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
