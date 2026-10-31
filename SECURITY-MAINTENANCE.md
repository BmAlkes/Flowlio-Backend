# Security deployment

Railway builds and starts with Node 22.23.4, declared in `.node-version` and
`engines.node`. Check for a hosting override before deploying. Build/start scripts
reject a divergent runtime. `/api/health` reports the effective Node version.

Keep `npm start`: it launches both HTTP and the durable worker. If hosted as
separate services, rebuild both with the same runtime. A restart of an old image
does not replace Node. Require passing CI, then rebuild from the reviewed commit.

Migration 0023 only adds seven columns to users, session and two_factor. Existing
factors remain verified; lockout counters start at zero, users are not banned and
existing sessions are not impersonated. Startup applies migrations transactionally
under the existing shared lock. Verify a recent provider backup before production
and retain it. Roll back application code on the patched runtime; do not drop
these additive columns or restore a vulnerable Node image.

Validate health/database, worker readiness, password login and OTP, portal
invitation acceptance, PDF export/parsing and HTTPS integrations in staging.
Do not send real invitations or charges as a smoke test without a test recipient.

## Tracked advisory, 2026-10-31

GHSA-g3hv-75wg-m249 flags minimatch below 11.0.1. Older APIs remain required by
ESLint and tool dependencies (including rewire bundled by the Brevo SDK). Current
uses process repository-controlled glob patterns; no user-facing glob execution
was identified. Do not force v11 into callers of the callable v3 API. Reassess
upstream compatible releases and do not supply untrusted glob input. CI prints
these moderate findings and blocks high/critical advisories.

The targeted esbuild override under @esbuild-kit/core-utils fixes its obsolete
development-server dependency; schema generation and migration tests cover it.
