import OBSWebSocket from "obs-websocket-js";

function percent(skipped, total) {
  if (!Number.isFinite(skipped) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.max(0, (skipped / total) * 100));
}

/**
 * Read-only OBS WebSocket connector.
 * It collects statistics only; it never issues scene, stream, recording, or
 * configuration-changing requests.
 */
export class ObsConnector {
  constructor({ address, password = "", enabled = false, pollIntervalMs = 2000 }) {
    this.address = address;
    this.password = password;
    this.enabled = enabled;
    this.pollIntervalMs = pollIntervalMs;
    this.client = new OBSWebSocket();
    this.connected = false;
    this.connecting = false;
    this.lastError = null;
    this.lastUpdatedAt = null;
    this.stream = { active: false };
    this.telemetry = {
      renderingLagPercent: null,
      encodingLagPercent: null,
      networkDroppedFramesPercent: null
    };
    this.pollTimer = null;
    this.reconnectTimer = null;

    this.client.on("ConnectionClosed", () => {
      this.connected = false;
      this.stream = { active: false };
    });
  }

  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.connected,
      address: this.address,
      lastError: this.lastError,
      lastUpdatedAt: this.lastUpdatedAt,
      stream: this.stream
    };
  }

  getTelemetry() {
    return { ...this.telemetry };
  }

  async start() {
    if (!this.enabled) return;
    await this.connect();
    this.reconnectTimer = setInterval(() => {
      if (!this.connected && !this.connecting) void this.connect();
    }, 5000);
    this.pollTimer = setInterval(() => {
      if (this.connected) void this.poll();
    }, this.pollIntervalMs);
  }

  async connect() {
    if (!this.enabled || this.connected || this.connecting) return;
    this.connecting = true;
    try {
      await this.client.connect(this.address, this.password || undefined);
      this.connected = true;
      this.lastError = null;
      await this.poll();
      console.log("[Streamify OBS] Connected to OBS WebSocket.");
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : "OBS connection failed";
      console.warn("[Streamify OBS] Connection unavailable:", this.lastError);
    } finally {
      this.connecting = false;
    }
  }

  async poll() {
    if (!this.connected) return;
    try {
      const stats = await this.client.call("GetStats");
      const streamStatus = await this.client.call("GetStreamStatus");

      this.telemetry = {
        renderingLagPercent: percent(stats.renderSkippedFrames, stats.renderTotalFrames),
        encodingLagPercent: percent(stats.outputSkippedFrames, stats.outputTotalFrames),
        // OBS WebSocket does not expose a dropped-network-frame percentage
        // in GetStats. Do not substitute outputCongestion: it is a different metric.
        networkDroppedFramesPercent: null
      };
      this.stream = {
        active: Boolean(streamStatus.outputActive),
        reconnecting: Boolean(streamStatus.outputReconnecting),
        duration: streamStatus.outputDuration ?? null,
        congestion: Number.isFinite(streamStatus.outputCongestion)
          ? streamStatus.outputCongestion
          : null
      };
      this.lastUpdatedAt = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "OBS telemetry request failed";
    }
  }

  async stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.reconnectTimer);
    if (this.connected) {
      try { await this.client.disconnect(); } catch { /* already disconnected */ }
    }
    this.connected = false;
  }
}
