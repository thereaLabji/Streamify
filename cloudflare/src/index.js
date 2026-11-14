
const PAIRING_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function randomPairingCode() {
  const limit = (1n << 56n) / 10000000000000000n * 10000000000000000n;
  while (true) {
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value < limit) return (value % 10000000000000000n).toString().padStart(16, "0");
  }
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function rateLimit(env, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO auth_rate_limits (rate_key, window_started_at, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(rate_key) DO UPDATE SET
      attempts = CASE
        WHEN window_started_at <= ? THEN 1
        ELSE attempts + 1
      END,
      window_started_at = CASE
        WHEN window_started_at <= ? THEN excluded.window_started_at
        ELSE window_started_at
      END
  `).bind(key, now, now - windowSeconds, now - windowSeconds).run();
  const row = await env.DB.prepare(
    "SELECT attempts FROM auth_rate_limits WHERE rate_key = ?"
  ).bind(key).first();
  return Boolean(row && row.attempts <= limit);
}

async function requestIpKey(request, purpose) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return `${purpose}:${await sha256Hex(ip)}`;
}

async function issuePairingCode(request, env) {
  if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await readBody(request); }
  catch (error) {
    return json({ error: error.message === "body_too_large" ? "body_too_large" : "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || !validIngestSlug(body.slug, env)) return json({ error: "invalid_slug" }, 400);
  const allowed = await rateLimit(env, `pair-create:${body.slug}`, 5, 3600);
  if (!allowed) return json({ error: "rate_limited" }, 429);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM pairing_codes WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at < ?)").bind(now, now - 86400).run();
  await env.DB.prepare("DELETE FROM streamer_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(now, now - 86400).run();
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < ?").bind(now - 86400).run();
  const code = await randomPairingCode();
  const codeHash = await sha256Hex(code);
  await env.DB.prepare(
    "UPDATE pairing_codes SET used_at = ? WHERE slug = ? AND used_at IS NULL"
  ).bind(now, body.slug).run();
  await env.DB.prepare(
    "INSERT INTO pairing_codes (code_hash, slug, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(codeHash, body.slug, now, now + PAIRING_TTL_SECONDS).run();
  return json({ code, expiresAt: new Date((now + PAIRING_TTL_SECONDS) * 1000).toISOString() }, 201);
}

async function exchangePairingCode(request, env) {
  const ipKey = await requestIpKey(request, "pair-exchange");
  if (!(await rateLimit(env, ipKey, 10, 900))) return json({ error: "rate_limited" }, 429);
  let body;
  try { body = await readBody(request); }
  catch (error) {
    return json({ error: error.message === "body_too_large" ? "body_too_large" : "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || typeof body.code !== "string" || !/^\d{16}$/.test(body.code)) {
    return json({ error: "invalid_pairing_code" }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const codeHash = await sha256Hex(body.code);
  const row = await env.DB.prepare(
    "SELECT slug FROM pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?"
  ).bind(codeHash, now).first();
  if (!row) return json({ error: "invalid_or_expired_code" }, 401);

  const consumed = await env.DB.prepare(
    "UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?"
  ).bind(now, codeHash, now).run();
  if (!consumed.meta || consumed.meta.changes !== 1) {
    return json({ error: "invalid_or_expired_code" }, 401);
  }

  const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await env.DB.prepare(
    "INSERT INTO streamer_sessions (token_hash, slug, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, row.slug, now, expiresAt).run();
  return json({
    streamer: row.slug,
    sessionToken,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  }, 201);
}

async function readSession(request, env) {
  const token = bearer(request);
  if (!token || token.length > 256) return null;
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  return env.DB.prepare(
    "SELECT slug, expires_at FROM streamer_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
  ).bind(tokenHash, now).first();
}

async function sessionRoute(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (request.method === "GET") {
    return json({ authenticated: true, streamer: session.slug,
      expiresAt: new Date(session.expires_at * 1000).toISOString() });
  }
  if (request.method === "DELETE") {
    const tokenHash = await sha256Hex(bearer(request));
    await env.DB.prepare(
      "UPDATE streamer_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
    ).bind(Math.floor(Date.now() / 1000), tokenHash).run();
    return json({ revoked: true });
  }
  return json({ error: "method_not_allowed" }, 405, { allow: "GET, DELETE" });
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

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
    headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS";
    headers["access-control-allow-headers"] = "Authorization, Content-Type";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

function validSlug(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value);
}

function validIngestSlug(value, env) {
  return validSlug(value) && (!env.STREAMIFY_INGEST_SLUG || value === env.STREAMIFY_INGEST_SLUG);
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

    if (url.pathname === "/v1/pairing/code" && request.method === "POST") {
      return withCors(await issuePairingCode(request, env), cors);
    }

    if (url.pathname === "/v1/pairing/exchange" && request.method === "POST") {
      return withCors(await exchangePairingCode(request, env), cors);
    }

    if (url.pathname === "/v1/session" && (request.method === "GET" || request.method === "DELETE")) {
      return withCors(await sessionRoute(request, env), cors);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "Streamify Public API", state: "healthy" }, 200, cors);
    }

    if (url.pathname === "/v1/heartbeat" && request.method === "POST") {
      if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401, cors);
      try {
        const body = await readBody(request);
        if (!validIngestSlug(body.slug, env)) return json({ error: "invalid_slug" }, 400, cors);
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
        if (!validIngestSlug(body.slug, env)) return json({ error: "invalid_slug" }, 400, cors);
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
