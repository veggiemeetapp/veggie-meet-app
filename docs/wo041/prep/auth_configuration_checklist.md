# Auth Configuration Checklist (Production)

All items are verified in the fresh production Lovable Cloud project.
No secrets belong in this document.

Legend — Severity: **P0** blocks launch; **P1** blocks public traffic;
**P2** must be fixed within 24h; **P3** track and fix.

| # | Item | Required value / behavior | Where to configure | How to test | Failure symptom | Severity | Owner-only? |
|---|---|---|---|---|---|---|---|
| 1 | Email/password provider | Enabled | Cloud → Users → Providers → Email | Sign up with test email | "Provider disabled" on signup | P0 | No |
| 2 | Email confirmation | Enabled (required) | Cloud → Users → Auth settings → Email | Sign up; verify link required before login | User logs in without verifying | P0 | No |
| 3 | Anonymous sign-in | Disabled | Cloud → Users → Auth settings | `supabase.auth.signInAnonymously()` errors | Anonymous session created | P0 | No |
| 4 | Google OAuth | Enabled + client id/secret configured | Cloud → Users → Providers → Google | Sign in with Google → callback lands on Today | "Unsupported provider" | P0 | Yes |
| 5 | Production site URL | `https://<production-domain>` | Cloud → Users → URL configuration | Password reset email links to production | Reset lands on preview/localhost | P0 | Yes |
| 6 | Allowed redirect URLs | `https://<domain>/*`, `https://<domain>/auth/callback` | Cloud → Users → URL configuration | OAuth callback + magic link redirect | "redirect_uri not allowed" | P0 | Yes |
| 7 | Password reset URL | `https://<domain>/auth/callback` | Auth email template | Trigger reset, follow link | Broken link / preview URL | P0 | Yes |
| 8 | OAuth callback URL | `https://<domain>/auth/callback` (also registered in Google Cloud Console) | Google console + Lovable Cloud | Full Google sign-in | Google shows "redirect_uri_mismatch" | P0 | Yes |
| 9 | Sign-out redirect | Returns to `/` (public route) | App code — `useAuth.signOut()` | Sign out from Settings | Blank page or 404 | P1 | No |
| 10 | Session persistence | localStorage, autoRefresh on | `src/integrations/supabase/client.ts` (already correct) | Reload logged-in page → still logged in | Silent sign-out on reload | P1 | No |
| 11 | Token refresh | Enabled | Same as above | Wait past `expires_at`; app still calls RPCs | 401 after ~1h idle | P1 | No |
| 12 | Auth email templates | Branded VeggieMeet copy | Cloud → Users → Email templates | Trigger signup, reset, magic link — inspect subject/body | Default Supabase branding | P2 | Yes |
| 13 | Sender branding | Custom sending domain if configured, else managed | Cloud → Users → SMTP / domain | Check "From" address on real inbox | Emails from `noreply@supabase.io` | P2 | Yes |
| 14 | Rate limiting (auth emails) | Default 30/h unless launch traffic estimate is higher | Cloud → Users → Auth settings → Rate limits | Attempt >limit signups; expect `over_email_send_rate_limit` | Real users blocked at launch | P1 | Yes |
| 15 | HIBP leaked-password protection | Enabled | Cloud → Users → Auth settings → Password HIBP | Try known-leaked password — signup rejected | Weak passwords accepted | P1 | No (via `configure_auth`) |
| 16 | User enumeration protection | Enabled (default). Signup / reset responses do not disclose whether an email exists. | Cloud default | Attempt reset for unknown email — generic response | Different response for known vs unknown email | P1 | No |

## Verification order

1. Item 1 → 3 (provider basics).
2. Item 5 → 8 (URL configuration; must be right before any real OAuth test).
3. Item 4 (Google end-to-end).
4. Item 15 (HIBP via `configure_auth`).
5. Item 12 → 14 (email surface).
6. Item 9 → 11, 16 (behavioral checks).
