// WO-088 temporary owner-only QA actor provisioning function.
// Scope: can ONLY create/delete the three fixed wo088qa.* @lovable-smoke.test
// accounts, and only for a caller present in public.owner_allowlist.
// This function is deleted at the end of WO-088.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const ALLOWED = new Set([
  "wo088qa.a@lovable-smoke.test",
  "wo088qa.b@lovable-smoke.test",
  "wo088qa.c@lovable-smoke.test",
]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ error: "unauthorized" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const { data: owner } = await admin
    .from("owner_allowlist")
    .select("auth_user_id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!owner) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const emails: string[] = Array.isArray(body?.emails) ? body.emails : [];
  const bad = emails.filter((e) => !ALLOWED.has(e));
  if (!emails.length || bad.length) return json({ error: "invalid_emails", bad }, 400);

  const results: Record<string, unknown>[] = [];

  if (action === "create") {
    const password = String(body?.password ?? "");
    if (password.length < 12) return json({ error: "weak_password" }, 400);
    for (const email of emails) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      results.push({ email, id: data?.user?.id ?? null, error: error?.message ?? null });
    }
    return json({ action, results });
  }

  if (action === "delete") {
    // Page through users to resolve ids for the fixed QA emails only.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) return json({ error: listErr.message }, 500);
    for (const email of emails) {
      const u = list.users.find((x) => x.email === email);
      if (!u) {
        results.push({ email, deleted: false, reason: "not_found" });
        continue;
      }
      const { error } = await admin.auth.admin.deleteUser(u.id);
      results.push({ email, id: u.id, deleted: !error, error: error?.message ?? null });
    }
    return json({ action, results });
  }

  return json({ error: "unknown_action" }, 400);
});
