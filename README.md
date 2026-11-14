# Streamify

An OBS companion and public website for streaming status.

**Current milestone: v0.2 — Streamify Core foundation**

## What exists now

- A standalone Node.js Core service in [`core/`](./core/README.md), with a loopback-only read API and initial diagnostics engine.

- A responsive, read-only public status page at [status.html](./status.html).
- The repository homepage redirects to the status page.
- A simple JSON status feed at [status.json](./status.json).
- The status page polls the JSON feed every 15 seconds and updates without a page reload.

## Status model

The feed supports four states:

| State | Meaning |
| --- | --- |
| `offline` | No active stream |
| `connecting` | OBS or the streaming connection is starting |
| `online` | Stream is live |
| `issues` | A stream or connection problem needs attention |

The public page is intentionally read-only. Viewers must never receive streamer controls or credentials.

## Status feed format

The initial `status.json` is an offline example. The future OBS integration or a secure status service can publish updates using this shape:

```json
{
  "state": "online",
  "summary": "Live and running normally.",
  "platform": "Twitch",
  "uptime": "00:42:18",
  "updatedAt": "2026-11-14T09:30:00Z",
  "healthTitle": "Stream is running",
  "healthDetails": "No reported rendering or network issues.",
  "message": "We are live!"
}
```

Do not put stream keys, passwords, private tokens, or other secrets in this public JSON file.

## Streamify Core

See [`core/README.md`](./core/README.md) for requirements, startup instructions, API endpoints, diagnostics behavior, and current limitations. Run it with Node.js 20 or newer from the `core` directory using `npm start`; run its tests using `npm test`.

The Core currently exposes read-only health and diagnostics endpoints. It does not yet connect to OBS or authenticate streamers.

## Planned architecture

1. **Public website** — read-only stream status for viewers.
2. **OBS integration** — streamer-only controls and OBS telemetry.
3. **Secure status service** — authenticated updates from OBS to the public feed.
4. **Diagnostics** — distinguish rendering lag, encoding lag, network-dropped frames, and stream latency.
5. **Recovery** — recommend or apply safe fixes; ask before actions that may interrupt a live stream.

## Important limitations

This milestone does not yet connect to OBS, read real stream telemetry, automatically repair issues, or provide authenticated streamer controls. The displayed status is only as current as the published `status.json`.

## GitHub Pages

If GitHub Pages is enabled for this repository, publish from the branch and folder containing these files. The public status page will be available at:

`https://thereaLabji.github.io/Streamify/status.html`

## Development

The website is plain HTML, CSS, and JavaScript. No build step or framework is required.
