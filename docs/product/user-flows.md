# User Flows

## Login (Current Harness Coverage)
1. Open `/login`.
2. Enter admin email and password.
3. Click **Sign in**.
4. User is redirected to their first allowed page.

Notes:
- Default first-boot admin values come from `.env` / `.env.example`.
- This flow is validated by Playwright in `apps/web/e2e/auth.smoke.spec.ts`.

## TODO
- TODO: Document task creation flow.
- TODO: Document repository connect/sync flow.
- TODO: Document settings and credentials flow.
