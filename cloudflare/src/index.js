const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGIN || "https://thereaLabji.github.io";
  const headers = { "vary": "Origin" };
  if (origin === allowed) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "Authorization, Content-Type";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

function validSlug(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value);
}

function validPercent(value) {
  return value === null || value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

async function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}

async function authorized(request, env) {
  const configured = env.STREAMIFY_INGEST_TOKEN;
  const header = request.headers.get("Authorization") || "";
  if (!configured || !header.startsWith("Bearer ")) return false;
  return constantTimeEqual(header.slice(7), configured);
}

async function readBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 8192) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 8192) throw new Error("body_too_large");
  return JSON.parse(text);
}

async function saveHeartbeat(env, slug, now) {
  await env.DB.prepare(`
    INSERT INTO streamer_status (
      slug, stream_state, diagnostics_state, updated_at, last_seen_at
    ) VALUES (?, 'offline', 'unknown', ?, ?)
    ON CONFLICT(slug) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).bind(slug, now, now).run();
}

async function saveStatus(env, body, now) {
  const metrics = body.metrics || {};
  await env.DB.prepare(`
    INSERT INTO streamer_status (
      slug, stream_state, stream_title, category, diagnostics_state,
      rendering_lag_percent, encoding_lag_percent, network_dropped_frames_percent,
      viewers, updated_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      stream_state = excluded.stream_state,
      stream_title = excluded.stream_title,
      category = excluded.category,
      diagnostics_state = excluded.diagnostics_state,
      rendering_lag_percent = excluded.rendering_lag_percent,
      encoding_lag_percent = excluded.encoding_lag_percent,
      network_dropped_frames_percent = excluded.network_dropped_frames_percent,
      viewers = excluded.viewers,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
  `).bind(
    body.slug,
    body.streamState,
    typeof body.title === "string" ? body.title.slice(0, 120) : null,
    typeof body.category === "string" ? body.category.slice(0, 80) : null,
    body.diagnosticsState || "unknown",
    metrics.renderingLagPercent ?? null,
    metrics.encodingLagPercent ?? null,
    metrics.networkDroppedFramesPercent ?? null,
    Number.isInteger(body.viewers) && body.viewers >= 0 ? body.viewers : null,
    now,
    now
  ).run();
}

async function publicStatus(env, slug) {
  const row = await env.DB.prepare(
    "SELECT * FROM streamer_status WHERE slug = ?"
  ).bind(slug).first();

  if (!row) return null;

  const ttl = Math.max(30, Number(env.HEARTBEAT_TTL_SECONDS) || 90);
  const lastSeen = Date.parse(row.last_seen_at);
  const stale = !Number.isFinite(lastSeen) || Date.now() - lastSeen > ttl * 1000;
  return {
    streamer: row.slug,
    state: stale ? "offline" : row.stream_state,
    stream: {
      title: row.stream_title,
      category: row.category,
      viewers: row.viewers
    },
    diagnostics: {
      state: stale ? "unknown" : row.diagnostics_state,
      renderingLagPercent: stale ? null : row.rendering_lag_percent,
      encodingLagPercent: stale ? null : row.encoding_lag_percent,
      networkDroppedFramesPercent: stale ? null : row.network_dropped_frames_percent
    },
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
    stale
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "Streamify Public API", state: "healthy" }, 200, cors);
    }

    if (url.pathname === "/v1/heartbeat" && request.method === "POST") {
      if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401, cors);
      try {
        const body = await readBody(request);
        if (!validSlug(body.slug)) return json({ error: "invalid_slug" }, 400, cors);
        const now = new Date().toISOString();
        await saveHeartbeat(env, body.slug, now);
        return json({ accepted: true, lastSeenAt: now }, 202, cors);
      } catch (error) {
        return json({ error: error.message === "body_too_large" ? "body_too_large" : "invalid_json" }, 400, cors);
      }
    }

    if (url.pathname === "/v1/status" && request.method === "POST") {
      if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401, cors);
      try {
        const body = await readBody(request);
        if (!validSlug(body.slug)) return json({ error: "invalid_slug" }, 400, cors);
        if (!["live", "offline"].includes(body.streamState)) {
          return json({ error: "invalid_stream_state" }, 400, cors);
        }
        if (body.diagnosticsState && !["healthy", "issues", "insufficient_data", "unknown"].includes(body.diagnosticsState)) {
          return json({ error: "invalid_diagnostics_state" }, 400, cors);
        }
        const metrics = body.metrics || {};
        if (![metrics.renderingLagPercent, metrics.encodingLagPercent, metrics.networkDroppedFramesPercent].every(validPercent)) {
          return json({ error: "invalid_metrics" }, 400, cors);
        }
        const now = new Date().toISOString();
        await saveStatus(env, body, now);
        return json({ accepted: true, updatedAt: now }, 202, cors);
      } catch (error) {
        return json({ error: error.message === "body_too_large" ? "body_too_large" : "invalid_json" }, 400, cors);
      }
    }

    const match = url.pathname.match(/^\/v1\/status\/([a-z0-9-]+)$/);
    if (match && request.method === "GET") {
      if (!validSlug(match[1])) return json({ error: "invalid_slug" }, 400, cors);
      const status = await publicStatus(env, match[1]);
      return status ? json(status, 200, cors) : json({ error: "streamer_not_found" }, 404, cors);
    }

    return json({ error: "not_found" }, 404, cors);
  }
};
