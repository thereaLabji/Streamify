const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47821;

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("STREAMIFY_CORE_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    host: env.STREAMIFY_CORE_HOST || DEFAULT_HOST,
    port: env.STREAMIFY_CORE_PORT
      ? parsePort(env.STREAMIFY_CORE_PORT)
      : DEFAULT_PORT,
    environment: env.NODE_ENV || "development"
  });
}
