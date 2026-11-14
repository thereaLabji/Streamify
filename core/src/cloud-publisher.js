/**
 * Publishes a minimal, read-only OBS status snapshot to Streamify's public API.
 * The ingest token is only sent in the Authorization header and is never logged.
 */
export class CloudPublisher {
  constructor({ apiUrl, token, slug, slogan = "", obs, intervalMs = 15000 }) {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.token = token;
    this.slug = slug;
    this.slogan = slogan;
    this.obs = obs;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.inFlight = null;
  }

  async start() {
    if (this.timer) return;
    await this.publish();
    this.timer = setInterval(() => void this.publish(), this.intervalMs);
  }

  async publish() {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.sendSnapshot();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async sendSnapshot() {
    const obsStatus = this.obs.getStatus();
    const telemetry = this.obs.getTelemetry();
    const diagnostics = obsStatus.connected
      ? this.evaluate(telemetry)
      : { state: "unknown" };

    const body = {
      slug: this.slug,
      slogan: this.slogan,
      streamState: obsStatus.connected && obsStatus.stream?.active ? "live" : "offline",
      diagnosticsState: diagnostics.state,
      metrics: {
        renderingLagPercent: telemetry.renderingLagPercent ?? null,
        encodingLagPercent: telemetry.encodingLagPercent ?? null,
        networkDroppedFramesPercent: telemetry.networkDroppedFramesPercent ?? null
      }
    };

    try {
      const response = await fetch(`${this.apiUrl}/v1/status`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${this.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        console.warn(`[Streamify Cloud] Status publish rejected (HTTP ${response.status}).`);
        return;
      }
      console.log("[Streamify Cloud] Public status updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      console.warn("[Streamify Cloud] Status publish failed:", message);
    }
  }

  // Kept injectable so the publisher has no dependency on diagnostics internals.
  evaluate(telemetry) {
    const values = Object.values(telemetry);
    if (values.every(value => value === null || value === undefined)) {
      return { state: "insufficient_data" };
    }
    const hasIssue = values.some(value => Number.isFinite(value) && value >= 2);
    const hasUnknown = values.some(value => value === null || value === undefined);
    return { state: hasIssue ? "issues" : hasUnknown ? "insufficient_data" : "healthy" };
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight;
  }
  async createPairingCode() {
    const response = await fetch(`${this.apiUrl}/v1/pairing/code`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ slug: this.slug }),
      signal: AbortSignal.timeout(8000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `pairing_request_failed_${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (typeof payload.code !== "string" || !/^\d{16}$/.test(payload.code)) {
      throw new Error("invalid_pairing_response");
    }
    return { code: payload.code, expiresAt: payload.expiresAt };
  }

}
