import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTelemetry } from "../src/diagnostics/engine.js";

test("missing telemetry is unknown, not healthy", () => {
  const result = evaluateTelemetry({});
  assert.equal(result.state, "insufficient_data");
  assert.equal(result.metrics.renderingLagPercent.state, "unknown");
});

test("healthy telemetry returns healthy", () => {
  const result = evaluateTelemetry({
    renderingLagPercent: 0.2,
    encodingLagPercent: 0.1,
    networkDroppedFramesPercent: 0
  });
  assert.equal(result.state, "healthy");
  assert.equal(result.findings.length, 0);
});

test("high network dropped frames creates a finding", () => {
  const result = evaluateTelemetry({
    renderingLagPercent: 0,
    encodingLagPercent: 0,
    networkDroppedFramesPercent: 3
  });
  assert.equal(result.state, "issues");
  assert.equal(result.findings[0].code, "network_dropped_frames");
});

test("invalid metric values are reported", () => {
  const result = evaluateTelemetry({
    renderingLagPercent: 120
  });
  assert.equal(result.state, "issues");
  assert.equal(result.findings[0].code, "invalid_metric");
});

test("invalid snapshots are rejected", () => {
  assert.throws(() => evaluateTelemetry(null), TypeError);
});
