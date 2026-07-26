# RadarBet

A full-stack football betting management and prediction app powered by Gemini AI. Users get AI-driven match radar and analysis, then track their bets with ROI stats. Admins control user subscriptions.

## Run & Operate

- `pnpm --filter @workspace/football-bets run dev` — frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run seed` — insert seed data (admin user)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — auto-provisioned via Clerk
- Required env: `RAPIDAPI_KEY` — API-Football key from RapidAPI (100 req/day free tier)
- Optional env: `ENCRYPTION_KEY` — AES-256-GCM key for Gemini API key encryption (falls back to SESSION_SECRET)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS v4 + Wouter (routing)
- Auth: Clerk (Replit-managed) via `@clerk/react` + `@clerk/express`
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- AI: Gemini REST API (user-supplied API keys, stored encrypted)

## Where things live

- `artifacts/football-bets/` — React frontend
- `artifacts/api-server/` — Express API server
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation
- `lib/db/src/schema/` — Drizzle schema (users, userConfigs, bets tables)

## Architecture decisions

- **JIT user provisioning:** Users are created in the DB on first authenticated API call using their Clerk ID. The first user to register becomes admin automatically.
- **Encrypted Gemini keys:** Each user's Gemini API key is encrypted with AES-256-GCM before storage. Key comes from `ENCRYPTION_KEY` env var (falls back to `SESSION_SECRET`).
- **Subscription gating:** `/matches/radar` and `/matches/analyze` return 403 if `active_subscription = false`. Admin can toggle any user's subscription via `/users/:userId/subscription`.
- **Gemini SYSTEM_ANALYSIS_PROMPT:** Empty constant in `artifacts/api-server/src/lib/gemini.ts` — fill it in to customize the analysis prompt sent to Gemini for match analysis.
- **No mock data:** All match data and predictions come from the user's Gemini API key in real-time.

## Product

- **Landing page:** Public marketing page for unauthenticated users
- **Dashboard (`/dashboard`):** Radar de Partidos button → API-Football fetches today's real fixtures grouped by league (with live scores + match status). Each match has "Analizar Partido" → Gemini returns predictions. Each prediction has "Apostar" → bet registration modal.
- **Historial (`/historial`):** Full bet history with ROI stats, win rate, filter by status. One-click mark as Ganada/Perdida.
- **Configuración (`/configuracion`):** Gemini API key management, subscription status display, profile update.
- **Admin (`/admin`):** User management table with subscription toggle switches.

## Setup status

Project is fully set up to run on Replit:
- Dependencies installed from the checked-in lockfile via `pnpm install --frozen-lockfile` (also runs automatically on `scripts/post-merge.sh`)
- Managed workflows configured for the frontend (`artifacts/football-bets: web`), API server (`artifacts/api-server: API Server`), and mockup sandbox
- PostgreSQL provisioned via Replit's built-in database; `DATABASE_URL` is runtime-managed and auto-injected
- DB schema pushed via `pnpm --filter @workspace/db run push` (also runs automatically on `scripts/post-merge.sh`)
- Clerk authentication provisioned via Replit-managed Clerk; `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY` are set as secrets
- `SESSION_SECRET` is available in the environment (used as fallback `ENCRYPTION_KEY` for Gemini API key encryption)
- **Still needed:** `RAPIDAPI_KEY` — add as a Replit Secret to enable live football fixture fetching (sign up at https://rapidapi.com/api-sports/api/api-football, 100 req/day free tier)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any OpenAPI spec change, always run codegen before touching routes or frontend hooks.
- Clerk dev-key warning in console is normal and expected in development.
- `SYSTEM_ANALYSIS_PROMPT` in `artifacts/api-server/src/lib/gemini.ts` is intentionally empty — the admin fills it in.
- Gemini API key encryption uses `SESSION_SECRET` as fallback key; in production, set a dedicated `ENCRYPTION_KEY`.
- Drizzle `doublePrecision` columns return JS numbers directly (no string conversion needed).
