import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { evaluateTelemetry } from "./diagnostics/engine.js";
import { CoreEventBus } from "./event-bus.js";
import { ObsConnector } from "./obs/connector.js";

const config = loadConfig();
const events = new CoreEventBus();
const startedAt = Date.now();
const obs = new ObsConnector({ ...config.obs });

function sendJson(request, response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(request.method === "HEAD" ? undefined : payload);
}

function getRoute(url) {
  try {
    return new URL(url, "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  const route = getRoute(request.url);

  if (!route) {
    sendJson(request, response, 400, { error: "invalid_request_url" });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendJson(request, response, 405, { error: "method_not_allowed" });
    return;
  }

  if (route === "/health" || route === "/api/v1/core") {
    sendJson(request, response, 200, {
      name: "Streamify Core",
      version: "0.2.0",
      state: "running",
      environment: config.environment,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
      capabilities: {
        localApi: true,
        obsConnected: obs.connected,
        streamerAuthentication: false,
        telemetryIngestion: obs.connected,
        automaticRepair: false
      }
    });
    return;
  }

  if (route === "/api/v1/obs") {
    sendJson(request, response, 200, obs.getStatus());
    return;
  }

  if (route === "/api/v1/diagnostics") {
    const result = evaluateTelemetry(obs.getTelemetry());
    sendJson(request, response, 200, {
      state: obs.connected ? result.state : "waiting_for_telemetry",
      message: obs.connected
        ? "Diagnostics are evaluating the latest OBS statistics."
        : "Connect OBS WebSocket to begin diagnostics.",
      result
    });
    return;
  }

  sendJson(request, response, 404, { error: "not_found" });
});

server.on("error", error => {
  console.error("[Streamify Core] Server error:", error);
  process.exitCode = 1;
});

server.listen(config.port, config.host, async () => {
  console.log(`[Streamify Core] Listening at http://${config.host}:${config.port}`);
  console.log("[Streamify Core] Local-only API.");
  events.publish("core.started", { host: config.host, port: config.port });
  await obs.start();
});

async function shutdown(signal) {
  console.log(`[Streamify Core] ${signal} received; shutting down.`);
  await obs.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
