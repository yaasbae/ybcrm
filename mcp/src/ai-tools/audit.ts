import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { FirebaseService } from "../services/firebase.service.js";
import type { Logger } from "../utils/logger.js";
import type { AiAuditRecord, AiAuditSink } from "./types.js";

const SECRET_KEY = /secret|token|password|credential|authorization|cookie|private.?key|api.?key/i;
const PERSONAL_KEY = /phone|email|instagram|name|query|message|content/i;

function fingerprint(value: unknown) {
  const raw = String(value ?? "");
  return {
    redacted: true,
    fingerprint: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    length: raw.length,
  };
}

export function sanitizeForAudit(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (PERSONAL_KEY.test(key) && value !== null && value !== undefined) return fingerprint(value);
  if (depth > 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeForAudit(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([childKey, childValue]) => [childKey, sanitizeForAudit(childValue, childKey, depth + 1)]),
    );
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
}

export function summarizeResult(value: unknown): unknown {
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (!value || typeof value !== "object") return sanitizeForAudit(value);
  const row = value as Record<string, unknown>;
  const summary: Record<string, unknown> = { type: "object" };
  for (const key of ["id", "orderId", "total", "count", "page", "pageSize", "requestedPeriod"]) {
    if (key in row) summary[key] = sanitizeForAudit(row[key], key);
  }
  for (const [key, item] of Object.entries(row)) {
    if (Array.isArray(item)) summary[`${key}_count`] = item.length;
  }
  return summary;
}

export class FirestoreAiAuditSink implements AiAuditSink {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly logger: Logger,
  ) {}

  async write(record: AiAuditRecord): Promise<void> {
    try {
      await this.firebase.db().collection("ai_agent_audit_logs").add({
        ...record,
        server_timestamp: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      this.logger.error("Не удалось записать AI audit log", {
        tool: record.tool,
        status: record.status,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw error;
    }
  }
}

export class MemoryAiAuditSink implements AiAuditSink {
  readonly records: AiAuditRecord[] = [];

  async write(record: AiAuditRecord): Promise<void> {
    this.records.push(record);
  }
}
