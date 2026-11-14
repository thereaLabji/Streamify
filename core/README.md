# Streamify Core

Streamify Core is the local runtime that will connect the Streamify application, OBS integration, diagnostics, and future authenticated services.

## Requirements

- Node.js 20 or newer
- No third-party packages are required for this foundation

## Run

From this directory:

```sh
npm start
```

The API listens on `http://127.0.0.1:47821` by default.

You can override the port with `STREAMIFY_CORE_PORT`. The bind host defaults to loopback and should remain local-only during development.

## Initial endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Basic process health |
| GET | `/api/v1/core` | Core version, uptime, and capabilities |
| GET | `/api/v1/diagnostics` | Current diagnostics readiness |

The initial API is read-only. Telemetry ingestion and control routes will be added with the OBS Connector after an authentication and local-origin security design is in place.

## Diagnostics

The diagnostics engine is a pure evaluator. It distinguishes rendering lag, encoding lag, and network-dropped frames. Missing telemetry is marked unknown rather than healthy.

Initial warning thresholds are placeholders for development, not universal recommendations. They must be calibrated against OBS telemetry and made configurable before release.

## Safety

- Core binds to `127.0.0.1` by default.
- No stream keys, passwords, or access tokens are stored here.
- No OBS controls or automatic repairs exist in this milestone.
- Future actions that could interrupt a live stream must require explicit streamer approval.

## Tests

```sh
npm test
```

## Current limitations

This is the Core foundation only. It does not yet connect to OBS, accept telemetry, issue pairing codes, authenticate streamers, or publish to the public website.
