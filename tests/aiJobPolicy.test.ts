import assert from "node:assert/strict";
import test from "node:test";
import { canApproveJob, canCancelJob, createApprovalHash, getAiJobPolicy, initialAiJobStatus, retryDelayMs, statusAfterFailure } from "../src/lib/aiJobPolicy.ts";

test("unknown job types fail closed", () => {
  assert.equal(getAiJobPolicy("orders.delete"), null);
});

test("incident triage is safe and read-only by policy", () => {
  assert.equal(getAiJobPolicy("incident.triage")?.risk, "SAFE");
  assert.equal(initialAiJobStatus(getAiJobPolicy("incident.triage")!.risk), "queued");
});

test("daily business digest is safe and read-only by policy", () => {
  const policy = getAiJobPolicy("business.daily_digest");
  assert.equal(policy?.risk, "SAFE");
  assert.equal(policy?.timeoutMs, 90_000);
  assert.equal(initialAiJobStatus(policy!.risk), "queued");
});

test("approval jobs do not enter the executable queue", () => {
  assert.equal(initialAiJobStatus("APPROVAL"), "awaiting_approval");
  assert.equal(canApproveJob("awaiting_approval"), true);
  assert.equal(canApproveJob("running"), false);
});

test("forbidden jobs are rejected", () => {
  assert.throws(() => initialAiJobStatus("FORBIDDEN"));
});

test("only unfinished jobs can be cancelled", () => {
  assert.equal(canCancelJob("queued"), true);
  assert.equal(canCancelJob("running"), true);
  assert.equal(canCancelJob("succeeded"), false);
  assert.equal(canCancelJob("cancelled"), false);
  assert.equal(canCancelJob("dead_letter"), false);
});

test("approval hash binds the exact arguments independent of object key order", () => {
  const first = createApprovalHash("draft.task", "key-1", { title: "Позвонить", priority: 2 });
  const reordered = createApprovalHash("draft.task", "key-1", { priority: 2, title: "Позвонить" });
  const changed = createApprovalHash("draft.task", "key-1", { title: "Позвонить", priority: 3 });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("retry uses bounded exponential backoff and ends in DLQ", () => {
  assert.equal(retryDelayMs(1), 5_000);
  assert.equal(retryDelayMs(3), 20_000);
  assert.equal(retryDelayMs(100), 15 * 60_000);
  assert.equal(statusAfterFailure(2, 3), "retry_wait");
  assert.equal(statusAfterFailure(3, 3), "dead_letter");
});
