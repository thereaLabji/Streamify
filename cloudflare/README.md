# Streamify Public API

Cloudflare Worker + D1 backend for publishing streamer-safe status to the public Streamify website.

## Architecture

- Cloudflare Worker: public HTTPS API.
- D1: stores the latest public status and heartbeat.
- Streamify Core: authenticated publisher (implemented in a later integration step).
- GitHub Pages: public read-only status UI.

## Setup

Requirements: Node.js 20+ and a Cloudflare account.

```powershell
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create streamify-status
```

Copy the database ID returned by Wrangler into `wrangler.jsonc`, replacing `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.

Apply the migration locally, then remotely:

```powershell
npx wrangler d1 migrations apply streamify-status --local
npx wrangler d1 migrations apply streamify-status --remote
```

Create a long random ingestion token and store it as a Worker secret (never in Git):

```powershell
npx wrangler secret put STREAMIFY_INGEST_TOKEN
```

Deploy:

```powershell
npx wrangler deploy
```

The deployment prints the public `workers.dev` URL. Check `/health`.

## API

- `GET /health` — public service health.
- `POST /v1/heartbeat` — authenticated heartbeat; JSON body: `{"slug":"your-slug"}`.
- `POST /v1/status` — authenticated public-safe status update.
- `GET /v1/status/:slug` — public status for a streamer.

Status update example:

```json
{
  "slug": "your-slug",
  "streamState": "live",
  "title": "My stream",
  "category": "Just Chatting",
  "diagnosticsState": "issues",
  "metrics": {
    "renderingLagPercent": 0.4,
    "encodingLagPercent": 0.2,
    "networkDroppedFramesPercent": 32.1
  }
}
```

The API marks status offline and hides diagnostic values when no heartbeat has arrived within 90 seconds. The ingestion token is stored only as a Cloudflare Worker secret. Never put it in GitHub Pages or public JSON.

## Current boundary

This is the first public API foundation. Streamify Core publishing and the status-page API integration are subsequent tasks. Do not consider the public site live-connected until those pieces are deployed and verified.
