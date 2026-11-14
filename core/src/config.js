const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47821;

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    host: env.STREAMIFY_CORE_HOST || DEFAULT_HOST,
    port: env.STREAMIFY_CORE_PORT
      ? parsePort(env.STREAMIFY_CORE_PORT, "STREAMIFY_CORE_PORT")
      : DEFAULT_PORT,
    environment: env.NODE_ENV || "development",
    obs: Object.freeze({
      enabled: env.STREAMIFY_OBS_ENABLED === "true",
      address: env.STREAMIFY_OBS_ADDRESS || "ws://127.0.0.1:4455",
      password: env.STREAMIFY_OBS_PASSWORD || ""
    }),
    cloud: Object.freeze({
      apiUrl: (env.STREAMIFY_CLOUD_API_URL || "https://streamify-public-api.streamify-app.workers.dev").replace(/\/+$/, ""),
      token: env.STREAMIFY_INGEST_TOKEN || "",
      slug: env.STREAMIFY_STREAMER_SLUG || "ddz0",
      intervalMs: 15000
    })
  });
}
