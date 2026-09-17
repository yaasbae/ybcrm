export type AiJobRisk = "SAFE" | "APPROVAL" | "FORBIDDEN";
export type AiJobStatus =
  | "queued"
  | "awaiting_approval"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "dead_letter"
  | "cancelled";

export const AI_JOB_POLICIES = {
  "system.health_check": { risk: "SAFE", timeoutMs: 10_000, maxAttempts: 3 },
  "business.daily_digest": { risk: "SAFE", timeoutMs: 90_000, maxAttempts: 3 },
  "incident.triage": { risk: "SAFE", timeoutMs: 45_000, maxAttempts: 3 },
  "draft.task": { risk: "APPROVAL", timeoutMs: 30_000, maxAttempts: 3 },
  "draft.supplier_message": { risk: "APPROVAL", timeoutMs: 30_000, maxAttempts: 3 },
} as const;

export type AiJobType = keyof typeof AI_JOB_POLICIES;

export function getAiJobPolicy(type: string) {
  return AI_JOB_POLICIES[type as AiJobType] || null;
}

export function initialAiJobStatus(risk: AiJobRisk): AiJobStatus {
  if (risk === "FORBIDDEN") throw new Error("Действие запрещено политикой AI");
  return risk === "APPROVAL" ? "awaiting_approval" : "queued";
}

export function retryDelayMs(attempt: number, baseMs = 5_000, maxMs = 15 * 60_000) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

export function statusAfterFailure(attempt: number, maxAttempts: number): AiJobStatus {
  return attempt >= maxAttempts ? "dead_letter" : "retry_wait";
}

export function canApproveJob(status: AiJobStatus) {
  return status === "awaiting_approval";
}

export function canCancelJob(status: AiJobStatus) {
  return !["succeeded", "cancelled", "dead_letter"].includes(status);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createApprovalHash(type: string, idempotencyKey: string, payload: Record<string, unknown>) {
  return createHash("sha256").update(stableJson({ type, idempotencyKey, payload })).digest("hex");
}
import { createHash } from "node:crypto";
