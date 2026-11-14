const LIMITS = Object.freeze({
  renderingLagPercent: 2,
  encodingLagPercent: 2,
  networkDroppedFramesPercent: 2
});

function validPercent(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Evaluates a telemetry snapshot without changing OBS or system settings.
 * Missing metrics remain unknown; they are never interpreted as healthy.
 */
export function evaluateTelemetry(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("A telemetry snapshot object is required.");
  }

  const checks = [
    ["renderingLagPercent", "rendering_lag", "Rendering lag detected"],
    ["encodingLagPercent", "encoding_lag", "Encoding lag detected"],
    ["networkDroppedFramesPercent", "network_dropped_frames", "Network dropped frames detected"]
  ];

  const findings = [];
  const metrics = {};

  for (const [field, code, title] of checks) {
    const value = snapshot[field];

    if (value === undefined || value === null) {
      metrics[field] = { value: null, state: "unknown" };
      continue;
    }

    if (!validPercent(value)) {
      metrics[field] = { value: null, state: "invalid" };
      findings.push({
        severity: "warning",
        code: "invalid_metric",
        metric: field,
        title: `Invalid telemetry value: ${field}`,
        detail: "Expected a percentage between 0 and 100."
      });
      continue;
    }

    const issue = value >= LIMITS[field];
    metrics[field] = { value, state: issue ? "issue" : "healthy" };

    if (issue) {
      findings.push({
        severity: "warning",
        code,
        metric: field,
        title,
        detail: `${field} is ${value}%; the initial warning threshold is ${LIMITS[field]}%.`
      });
    }
  }

  const hasUnknown = Object.values(metrics).some(
    metric => metric.state === "unknown" || metric.state === "invalid"
  );

  return {
    state: findings.some(item => item.code !== "invalid_metric")
      ? "issues"
      : findings.length
        ? "issues"
        : hasUnknown
          ? "insufficient_data"
          : "healthy",
    evaluatedAt: new Date().toISOString(),
    metrics,
    findings,
    automaticActionsTaken: []
  };
}

export const DIAGNOSTIC_LIMITS = LIMITS;
