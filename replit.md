# MarcadorFijo

AI-powered football betting analysis app. Analyzes matches with real statistical data (team form, injuries, H2H) and generates value bet recommendations using Groq's LLaMA model.

## Stack

- **Frontend** (`artifacts/football-bets`): React + Vite + Tailwind + shadcn/ui, Clerk auth, Wouter routing
- **Backend** (`artifacts/api-server`): Express 5 + Drizzle ORM + PostgreSQL, Clerk auth middleware, Groq AI
- **Database** (`lib/db`): Drizzle schema — users, bets, analysis cache, user configs, subscription plans, system settings
- **Shared libs**: `lib/api-spec` (OpenAPI), `lib/api-zod` (Zod schemas), `lib/api-client-react` (typed React Query hooks)

## First-time setup on Replit

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Push DB schema** (Replit's PostgreSQL is pre-provisioned; `DATABASE_URL` is set automatically)
   ```bash
   pnpm --filter @workspace/db run push
   ```

3. **Set required secrets** in Replit Secrets (see table below):
   - `CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `GROQ_API_KEY`
   - `SESSION_SECRET`

4. **Set environment variables** (already configured in Replit shared env):
   - `BASE_PATH=/`
   - `NODE_ENV=development`
   - `LOG_LEVEL=info`

5. **Start workflows** — both are pre-configured in Replit and start automatically:
   - `artifacts/football-bets: web` → Vite dev server (frontend)
   - `artifacts/api-server: API Server` → Express dev server (backend)

## Running the project (daily)

Both workflows start automatically when the workspace opens. To restart manually:

```bash
# Frontend
pnpm --filter @workspace/football-bets run dev

# Backend
pnpm --filter @workspace/api-server run dev
```

## Required secrets

| Secret | Purpose | Where to get it |
|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | Clerk auth — public key, forwarded to frontend via Vite `define` | [clerk.com](https://clerk.com) dashboard → API Keys |
| `CLERK_SECRET_KEY` | Clerk auth — backend middleware | Same dashboard |
| `GROQ_API_KEY` | AI match analysis (LLaMA 3.3 70B) | [console.groq.com](https://console.groq.com) |
| `SESSION_SECRET` | Session encryption fallback | Any random string (32+ chars) |

`DATABASE_URL` is managed by Replit automatically — do not set it manually.

## Optional secrets (football data feeds)

These keys unlock live match stats, team form, and odds data. The app runs without them but AI analysis quality is reduced.

| Secret | Provider |
|---|---|
| `API_FOOTBALL_KEY_1` / `API_FOOTBALL_KEY_2` | [api-football.com](https://www.api-football.com) |
| `FOOTBALL_API_KEY` | Alternative football data provider |
| `ODDS_API_KEY_1` / `ODDS_API_KEY_2` | [the-odds-api.com](https://the-odds-api.com) |
| `THE_ODDS_API_KEY` | Same provider, alternate var name |

## Environment variables (non-secret)

| Variable | Value | Purpose |
|---|---|---|
| `BASE_PATH` | `/` | Vite base path for the frontend artifact |
| `NODE_ENV` | `development` | Runtime mode |
| `LOG_LEVEL` | `info` | Pino log level |

## Database schema

Managed with Drizzle ORM. Schema lives in `lib/db/src/schema/`:

| Table | Purpose |
|---|---|
| `users` | User accounts (Clerk user ID, role, subscription status) |
| `bets` | Bet records with status tracking (including voided) |
| `analysis_cache` | AI analysis results cached by date + teams + league |
| `subscription_plans` | Available subscription tiers |
| `system_settings` | Admin-configurable app settings |
| `user_configs` | Per-user configuration preferences |

Apply schema changes to development:
```bash
pnpm --filter @workspace/db run push
```

## Architecture notes

- The first user to register automatically becomes admin with an active subscription.
- AI analysis results are cached in `analysis_cache` (keyed by date + teams + league) to avoid redundant Groq API calls.
- The cron scheduler runs match analysis every 2 hours (02:00–22:00 UTC) plus a midnight lookback pass — ~12 calls/day.
- The Clerk proxy middleware (`/api/__clerk`) is active in production only; dev uses Clerk's CDN directly.
- The frontend reads `VITE_CLERK_PUBLISHABLE_KEY` which is injected at build time from `CLERK_PUBLISHABLE_KEY` via Vite's `define` config.
- Bet status contract: API enums must stay aligned with persisted `bets` table statuses, including `voided`.

## User preferences

- Keep the existing pnpm monorepo structure — do not restructure or migrate.
- App UI is in Spanish.
