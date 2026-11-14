import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { evaluateTelemetry } from "./diagnostics/engine.js";
import { CoreEventBus } from "./event-bus.js";

const config = loadConfig();
const events = new CoreEventBus();
const startedAt = Date.now();

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(payload);
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
    sendJson(response, 400, { error: "invalid_request_url" });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (route === "/health" || route === "/api/v1/core") {
    sendJson(response, 200, {
      name: "Streamify Core",
      version: "0.1.0",
      state: "running",
      environment: config.environment,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
      capabilities: {
        localApi: true,
        obsConnected: false,
        streamerAuthentication: false,
        telemetryIngestion: false,
        automaticRepair: false
      }
    });
    return;
  }

  if (route === "/api/v1/diagnostics") {
    sendJson(response, 200, {
      state: "waiting_for_telemetry",
      message: "Connect the OBS Connector to begin diagnostics.",
      result: evaluateTelemetry({})
    });
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.on("error", error => {
  console.error("[Streamify Core] Server error:", error);
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  console.log(`[Streamify Core] Listening at http://${config.host}:${config.port}`);
  console.log("[Streamify Core] Local-only API. No OBS connection is active yet.");
  events.publish("core.started", { host: config.host, port: config.port });
});

function shutdown(signal) {
  console.log(`[Streamify Core] ${signal} received; shutting down.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
