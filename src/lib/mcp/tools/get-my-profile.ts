import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_my_profile",
  title: "Get my profile",
  description:
    "Get the signed-in user's VeggieMeet profile: display name, city, interests, and community stats.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("get_my_profile");
    const row = (Array.isArray(data) ? data[0] : data) as
      | Record<string, unknown>
      | null;
    if (error || !row) {
      return {
        content: [{ type: "text", text: "Profile not found." }],
        isError: true,
      };
    }
    // Project only the fields the tool exposes — never leak auth_user_id.
    const projection = {
      id: row.id,
      display_name: row.display_name,
      bio: row.bio,
      current_city: row.current_city,
      interests: row.interests,
      is_active_host: row.is_active_host,
      meetups_hosted_count: row.meetups_hosted_count,
      meetups_attended_count: row.meetups_attended_count,
      onboarding_completed: row.onboarding_completed,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(projection, null, 2) }],
      structuredContent: projection,
    };
  },
});
