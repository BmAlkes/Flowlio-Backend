# Core API contracts (T12)

The backend owns `src/contracts/core-api.ts`. The frontend keeps an identical copy, including Zod schemas, canonical statuses and the method/path catalog.

From the backend repository:

```sh
node scripts/sync-api-contracts.cjs --frontend=../Flowlio-Frontend
node scripts/sync-api-contracts.cjs --frontend=../Flowlio-Frontend --check
npm run contracts:check
npm test
npm run build
```

Run frontend tests/build after synchronizing. Deploy backend first, then frontend. No SQL migration is required. T11 subscription changes remain on their separate branch.

## Scope

18 client/project/proposal method/path pairs are checked against routers actually mounted in server.ts. Tests deliberately remove/change a route to prove detection. Literal router registrations are supported; dynamic mounts require extending the checker. Other domains and viewer-only endpoints are not covered yet.

Read responses validate essential fields, canonical statuses and ISO timestamps, while preserving additional fields. This is incremental validation, not a complete DTO/OpenAPI specification. Mutation responses are not intercepted after a committed write. Client/project status input is validated before controllers execute.

Project aliases `active` and `in_progress` normalize to `ongoing`. Historical client pipeline states map as follows: New Lead/Contacted/Qualified/Proposal Sent -> Onboarding; Contract Signed/Project In Progress -> Active; Lost -> Churned. The explicit lead listing bypasses the client response contract; lead routes are unchanged. Existing records are not rewritten. The ORM default for new project status is pending.

Unknown statuses are rejected with INVALID_STATUS (400). Malformed read responses produce API_RESPONSE_INVALID (500), with only field paths/codes logged by the contract middleware. Fix the producer or deliberately evolve the shared schema; do not replace failed reads with empty lists. Existing authorization codes are preserved. Unknown /api paths return ENDPOINT_NOT_FOUND (404), including non-browser requests.

## Verification in the application

Open Client Management, a client detail's Projects and Proposals tabs, Projects, and Proposals. Existing records load with consistent statuses and date formatting. Proposal request failures show an error with retry. Do not corrupt production records to exercise failures: contract tests simulate incompatible payloads, invalid status input and missing endpoints locally.
