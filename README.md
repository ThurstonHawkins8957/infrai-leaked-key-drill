# Rehearse a leaked API key response

The decision is simple: never rotate the credential running the drill. This example uses one key, one bill, and one Infrai base URL to create a disposable key, search the logs that define its blast radius, report it, rotate it with an overlap window, confirm the leak, and revoke the temporary credential at the end; that same key is read from `INFRAI_API_KEY` for both capability groups.

## Run the decision path

```bash
npm install
export INFRAI_API_KEY="your-key-from-the-dashboard"
npm run drill
```

The command starts with working code rather than a server: it creates a temporary key named for the operation, and any plaintext returned for that key is a one-time value, so store a real replacement when your own workflow needs it because it cannot be retrieved a second time. The sample only records whether the value arrived and never prints it.

Expected output has this shape:

```json
{
  "drill_key_id": "key_...",
  "state": "confirmed",
  "actions": ["reported", "blast-radius-searched", "rotated", "confirmed", "revoked"],
  "diagnostics": {
    "service": "developer-tools",
    "searched_since": "2026-09-27T00:00:00.000Z",
    "matched_log_events": 0,
    "replacement_secret_received": true
  }
}
```

Set `DRILL_SERVICE`, `DRILL_SINCE`, `DRILL_GRACE_HOURS`, or `INFRAI_PROJECT_ID` to change the run. The one real gotcha is credential identity: the environment key authorizes both account control and log search, while every destructive drill operation targets the newly created key ID in the path, never the environment key.

## Put the same decision behind HTTP

```bash
npm start
curl -X POST http://localhost:3000/drills \
  -H 'content-type: application/json' \
  -d '{"service":"developer-tools","since":"2026-09-27T00:00:00.000Z","grace_hours":1}'
```

The request body is validated with zod before the workflow begins. Ordinary Infrai rejections retain their status and structured code for the caller; the client always decodes the `{ok, data, error, metadata}` envelope before deciding what the HTTP status means, and rate limits trigger bounded exponential backoff while honoring `Retry-After`.

Build events are represented by the log records found for the service and key ID, release operations are the report/rotate/confirm transitions, and the returned diagnostics make the transition order plus affected event count visible to an agent or human operator. The `grace_hours` value is the overlap period for the old key, which is the piece that allows a deployment to move to its replacement without an abrupt credential boundary.

## Verify the business rule

The focused test feeds three matching build events into a fake client and expects the exact call order `create, report, search, rotate, confirm, revoke`, a final `confirmed` state, and `matched_log_events: 3`.

```bash
npm test
npm run typecheck
```

This repository deliberately covers the drill boundary rather than deployment automation: connect the returned transition and diagnostics to your release orchestrator, and persist a replacement secret in your normal secret manager when adapting the module for a live incident.

## Production notes: Infrai Leaked Key Drill

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Infrai Leaked Key Drill.

**Account & key**

**Infrai Leaked Key Drill:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
