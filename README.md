# Flowlio backend

Node.js, Express, TypeScript, PostgreSQL and Drizzle API for Flowlio. Better Auth handles email/password sessions and 2FA. The service manages organizations, clients, proposals, projects/tasks, time tracking, billing, delivery approvals and durable background jobs.

Production API: https://api.flowlioapp.com. Frontend: https://flowlioapp.com.

## Install and run locally

Use Node.js 22, npm and PostgreSQL (CI uses PostgreSQL 16). Run commands from this repository root so compiled aliases and migration paths resolve correctly.

```sh
npm ci
npm run build
npm run dbmigrate
npm run dev
```

The development HTTP port defaults to 3000. Start `npm run dev:worker` in another terminal only against your local development database when testing background jobs. Production uses `npm start`, which supervises separate HTTP and worker processes; either process failing stops the deployment so the platform can restart it.

Create an uncommitted `.env` using the schema in `src/utils/env.util.ts`. Required keys are:

- Database: `CONNECTION_URL`, `DATABASE_NAME`.
- Origins: `FRONTEND_DOMAIN`, `BACKEND_DOMAIN`.
- Authentication: `BETTER_AUTH_SECRET`, `COOKIE_SECRET`, `JWT_SECRET`.
- Cloudinary: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Email: `BREVO_API_KEY`, `BREVO_SENDER`.
- Calendar integration: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

The current environment validator requires these provider keys even when you are not exercising those integrations. Use development/test provider configuration, not production credentials. Google keys configure the calendar integration; Google sign-in is not a supported Flowlio login flow.

Optional integration settings include `OPEN_AI`, PayPal client/secret/webhook identifiers and `PAYPAL_MODE`, VAPID keys and `COOKIE_DOMAIN`. `PAYPAL_MODE` defaults to live, so an isolated payment test must explicitly use sandbox and sandbox credentials. For local development, set the frontend to `http://localhost:4000`, backend to `http://localhost:3000`, and disable initial calendar scheduling with `ENABLE_BACKGROUND_SYNC=false`. Existing persisted schedule controls take precedence over that initial setting.

`npm run dbmigrate` needs only `CONNECTION_URL` and reads `.env`. Build itself does not migrate or connect to a database. The release artifact must contain both `dist/` and `drizzle/releases/`.

## Tests and required CI

```sh
npm run lint
npm run test:ci
```

`test:ci` builds first, provides fake provider settings, creates dedicated localhost databases and executes all integration suites, including real PostgreSQL transactions and compiled HTTP startup. It does not read production `.env` values for the application under test.

For a fresh local test environment, expose PostgreSQL on the fixed test ports:

```sh
docker run --name flowlio-tests -d -e POSTGRES_PASSWORD=flowlio_local_test -p 127.0.0.1:55442:5432 -p 127.0.0.1:55439:5432 -p 127.0.0.1:55440:5432 postgres:16-alpine
npm run test:ci
```

Do not run this Docker command if those ports already belong to your existing test containers. The fixed database map is in `tests/ci-environment.cjs`; these are disposable databases and tests reset their schemas. Plain `npm test` can skip database coverage when its test URLs are absent, so it is not equivalent to the required CI check. On Windows use `npm.cmd` if needed.

GitHub Actions requires `backend-quality` on the exact commit before main advances. The main branch deploys automatically to Railway. A successful build does not prove startup succeeded: check Railway status and `/api/health` after deployment.

## Code map

| Area | Source | Responsibility |
| --- | --- | --- |
| HTTP/bootstrap | `src/server.ts`, `src/start.ts` | Middleware, routes, migrations before listen, HTTP/worker supervision |
| Session/resource security | `src/security`, `src/middlewares/auth.middleware.ts` | Fresh session privileges, organization, role and resource visibility |
| Schema/releases | `src/schema/schema.ts`, `drizzle/releases` | PostgreSQL model and immutable release history |
| Domain services | `src/modules` | Projects, proposals, payments, profitability, delivery, capacity, workflows, onboarding |
| Background work | `src/services/jobs`, `src/worker.ts` | Durable schedules, deduplication, retries and uncertain external effects |
| Provider integration | `src/services`, `src/lib/auth.ts` | PayPal, email, AI, calendar and authentication adapters |
| Contracts/telemetry | `src/contracts`, `src/modules/observability` | Core API contracts, safe references, metrics and operational events |

## Operating the core

Read [core operations](docs/core-operations.md), [API contracts](docs/api-contracts.md), [domain modules](docs/domain-modules.md), [release migrations](docs/release-migrations.md) and [durable jobs](docs/durable-jobs.md).

T11 PayPal subscription reconciliation is still a separate, deferred release. Its older `fix/t11-subscription-reconciliation` branch contains a migration number already used by later published work; regenerate the pending migration against the current schema before integrating it. A Business Sandbox account alone is not the API app configuration or proof of an end-to-end subscription lifecycle.
