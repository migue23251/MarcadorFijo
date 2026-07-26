# MarcadorFijo

AI-powered football betting analysis app. Analyzes matches with real statistical data (team form, injuries, H2H) and generates value bet recommendations using Groq's LLaMA model.

## Stack

- **Frontend** (`artifacts/football-bets`): React + Vite + Tailwind + shadcn/ui, Clerk auth, Wouter routing
- **Backend** (`artifacts/api-server`): Express 5 + Drizzle ORM + PostgreSQL, Clerk auth middleware, Groq AI
- **Database** (`lib/db`): Drizzle schema — users, bets, analysis cache, user configs
- **Shared libs**: `lib/api-spec` (OpenAPI), `lib/api-zod` (Zod schemas), `lib/api-client-react` (typed React Query hooks)

## Running the project

```bash
# Install dependencies (already done)
pnpm install

# Push DB schema
pnpm --filter @workspace/db run push

# Start frontend (workflow: "artifacts/football-bets: web")
pnpm --filter @workspace/football-bets run dev

# Start API server (workflow: "artifacts/api-server: API Server")
pnpm --filter @workspace/api-server run dev
```

Both workflows are configured and start automatically in Replit.

## Required secrets

| Secret | Purpose |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | Clerk auth (public key, also forwarded to frontend via vite `define`) |
| `CLERK_SECRET_KEY` | Clerk auth (backend) |
| `GROQ_API_KEY` | AI match analysis (LLaMA 3.3 70B) |
| `SESSION_SECRET` | Session encryption fallback |

`DATABASE_URL` is managed by Replit automatically.

## Environment variables

| Variable | Value | Purpose |
|---|---|---|
| `BASE_PATH` | `/` | Vite base path for the frontend |
| `NODE_ENV` | `development` | Runtime mode |
| `LOG_LEVEL` | `info` | Pino log level |

## Architecture notes

- The first user to sign up automatically becomes admin with an active subscription.
- AI analysis results are cached in the `analysis_cache` DB table (keyed by date + teams + league) to avoid redundant API calls.
- The Clerk proxy middleware (`/api/__clerk`) is only active in production; dev uses Clerk's CDN directly.
- The frontend reads `VITE_CLERK_PUBLISHABLE_KEY` which is injected at build time from `CLERK_PUBLISHABLE_KEY` via Vite's `define` config.

## User preferences

- Keep the existing pnpm monorepo structure — do not restructure or migrate.
- App UI is in Spanish.
