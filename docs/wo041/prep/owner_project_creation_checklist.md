# Owner Production-Project Creation Checklist

Only the workspace owner can perform these steps. This Lovable session
(preview project) cannot create or repoint projects.

## Steps

1. **Create fresh project** — Lovable dashboard → New project.
2. **Name it** — `veggiemeet-production` (or agreed final name).
3. **Confirm fresh Cloud backend** — enable Lovable Cloud on the new
   project; verify a new project id is issued (not the preview
   `zllamljlygjkknsguuki`).
4. **Duplicate / import repository** — import the same repo the preview
   uses so the migration folder and app code are identical.
5. **Confirm production project has its own backend** — open the new
   project's `.env` and verify `VITE_SUPABASE_PROJECT_ID` differs from
   the preview id. Verify `VITE_SUPABASE_URL` differs.
6. **Open the production project build session** — start a new Lovable
   chat scoped to the production project.
7. **Provide WO-041 work order** — paste
   `wo041_production_handoff_prompt.md` and this preparation kit
   (`/mnt/documents/wo041/prep/`) into the session.
8. **Verify no preview keys or URLs** —
   `grep -rIn "zllamljlygjkknsguuki\|sb_publishable_8GBBSf4Dcm1n49Akt7dHSw" .` returns
   zero matches.
9. **Complete Google OAuth owner actions** —
   - Register production callback in Google Cloud Console
     (`https://<domain>/auth/callback`).
   - Enter client id / secret in Cloud → Users → Providers → Google.
10. **Complete production domain actions** —
    - Attach custom domain in Lovable → Publish → Domains.
    - Update Auth site URL + allowed redirects (see
      `auth_configuration_checklist.md` items 5–7).
    - Configure custom sending domain if used (item 13).

After step 10, hand control back to the production build session to
execute WO-041 mechanically.
