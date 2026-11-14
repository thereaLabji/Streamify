# Streamify Core

Streamify Core is the local runtime for Streamify, including a read-only OBS WebSocket connector and diagnostics.

## Requirements

- Node.js 20 or newer
- OBS Studio 28 or newer (built-in obs-websocket v5)

## Install and run

From this directory:

```sh
npm install
npm start
```

The API listens on `http://127.0.0.1:47821` by default. It remains bound to loopback for local development.

## Configure OBS

1. Open OBS Studio.
2. Open **Tools → WebSocket Server Settings**.
3. Enable the WebSocket server and keep the default port `4455`.
4. If authentication is enabled, copy the WebSocket password.
5. Start Streamify Core with these environment variables in PowerShell:

```powershell
$env:STREAMIFY_OBS_ENABLED = "true"
$env:STREAMIFY_OBS_ADDRESS = "ws://127.0.0.1:4455"
$env:STREAMIFY_OBS_PASSWORD = "YOUR_OBS_WEBSOCKET_PASSWORD"
npm start
```

If OBS authentication is disabled, omit the password variable. Do not commit your OBS password or share it publicly. The connector connects only to the local OBS WebSocket endpoint.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Basic process health |
| GET | `/api/v1/core` | Core version, uptime, and capabilities |
| GET | `/api/v1/obs` | OBS connection and stream status |
| GET | `/api/v1/diagnostics` | Current diagnostics |

## Telemetry coverage

The connector reads OBS `GetStats` and `GetStreamStatus` requests. Rendering lag and encoding lag percentages are calculated from OBS skipped/total frame counters. Network dropped frames remain `unknown` because the current OBS WebSocket statistics do not provide an equivalent dropped-frame percentage; stream congestion is exposed separately and is not mislabeled as dropped frames.

The connector is read-only. It does not change scenes, start/stop streaming or recording, or modify OBS settings. Diagnostics thresholds remain development placeholders and need calibration before release.

## Tests

```sh
npm test
```

Streamer authentication, pairing codes, automatic repair, and cloud publishing are not part of this milestone.


## Cloud publishing

Set the Cloudflare ingest token as a local environment variable (never commit it):

```powershell
$env:STREAMIFY_OBS_ENABLED = "true"
$env:STREAMIFY_OBS_ADDRESS = "ws://127.0.0.1:4455"
$env:STREAMIFY_OBS_PASSWORD = "YOUR_OBS_WEBSOCKET_PASSWORD"
$env:STREAMIFY_INGEST_TOKEN = "YOUR_CLOUDFLARE_INGEST_TOKEN"
$env:STREAMIFY_STREAMER_SLUG = "ddz0"
npm start
```

Core publishes a minimal OBS status snapshot every 15 seconds to the configured Cloudflare API. The public status page reads `/v1/status/ddz0`. The token stays on the streamer's machine and is sent only as a Bearer authorization header. Do not expose it in browser code, public configuration, or Git.
