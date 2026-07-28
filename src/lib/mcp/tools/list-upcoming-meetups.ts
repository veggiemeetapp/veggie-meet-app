import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_upcoming_meetups",
  title: "List upcoming meetups",
  description:
    "List upcoming VeggieMeet meetups the signed-in user can see, ordered by date. Optionally filter by city.",
  inputSchema: {
    city: z
      .string()
      .optional()
      .describe("Optional city name to filter meetups (e.g. 'Berlin')."),
    limit: z
      .number()
      .int()
      .optional()
      .describe("Max meetups to return. Defaults to 20."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ city, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated." }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase
      .from("meetups")
      .select(
        "id, title, description, category, date, start_time, end_time, capacity, status, custom_location_name, custom_location_address, host_id",
      )
      .gte("date", today)
      .order("date", { ascending: true })
      .limit(Math.min(Math.max(limit ?? 20, 1), 50));

    const { data, error } = await q;
    if (error) {
      return {
        content: [{ type: "text", text: `Failed to fetch meetups: ${error.message}` }],
        isError: true,
      };
    }
    let rows = data ?? [];
    if (city && city.trim()) {
      const c = city.trim().toLowerCase();
      rows = rows.filter((r) =>
        (r.custom_location_address ?? "").toLowerCase().includes(c) ||
        (r.custom_location_name ?? "").toLowerCase().includes(c),
      );
    }
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { meetups: rows },
    };
  },
});
