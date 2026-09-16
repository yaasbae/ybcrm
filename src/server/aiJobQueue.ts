import type { Express, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  canApproveJob,
  getAiJobPolicy,
  initialAiJobStatus,
  retryDelayMs,
  statusAfterFailure,
  type AiJobType,
} from "../lib/aiJobPolicy.ts";

type OwnerGuard = (req: Request, res: Response) => Promise<unknown | null>;
type Executor = (payload: Record<string, unknown>) => Promise<unknown>;
type QueueOptions = { workerSecret?: string; notifyDeadLetter?: (message: string) => Promise<void> };

const JOBS = "ai_jobs";
const CONTROL = "ai_runtime_control";
const AUDIT = "ai_agent_audit_logs";
const MAX_PAYLOAD_BYTES = 32_000;

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Неизвестная ошибка";
}

function idFor(type: string, key: string) {
  return createHash("sha256").update(`${type}:${key}`).digest("hex");
}

async function runtimeEnabled(db: Firestore) {
  const snap = await db.collection(CONTROL).doc("global").get();
  return snap.exists && snap.data()?.enabled === true;
}

async function writeAudit(db: Firestore, input: {
  actor: string;
  tool: string;
  jobId?: string;
  status: "success" | "error" | "denied";
  result?: Record<string, unknown>;
}) {
  await db.collection(AUDIT).add({
    agent_id: "ai-job-system",
    user_id: input.actor.slice(0, 200),
    timestamp: new Date().toISOString(),
    tool: input.tool.slice(0, 120),
    arguments: input.jobId ? { jobId: input.jobId } : {},
    reason: "AI background job lifecycle",
    result: input.result || {},
    status: input.status,
    approval_required: input.tool.includes("approve"),
    approval_by: input.tool.includes("approve") ? input.actor.slice(0, 200) : null,
    cost_tokens: null,
    server_timestamp: FieldValue.serverTimestamp(),
  });
}

async function owner(req: Request, res: Response, guard: OwnerGuard) {
  const user = await guard(req, res);
  return user ? user as Record<string, unknown> : null;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Превышено время выполнения задания")), timeoutMs)),
  ]);
}

export function installAiJobQueue(app: Express, db: Firestore, requireOwner: OwnerGuard, options: QueueOptions = {}) {
  const executors: Partial<Record<AiJobType, Executor>> = {
    "system.health_check": async () => ({ ok: true, checkedAt: new Date().toISOString() }),
  };

  app.get("/api/ai-jobs/runtime", async (req, res) => {
    if (!await owner(req, res, requireOwner)) return;
    res.json({ enabled: await runtimeEnabled(db) });
  });

  app.post("/api/ai-jobs/runtime", async (req, res) => {
    const actor = await owner(req, res, requireOwner);
    if (!actor) return;
    const enabled = req.body?.enabled === true;
    await db.collection(CONTROL).doc("global").set({
      enabled,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: String(actor.email || actor.uid || "owner").slice(0, 200),
    }, { merge: true });
    await writeAudit(db, { actor: String(actor.email || actor.uid || "owner"), tool: "ai_jobs.kill_switch", status: "success", result: { enabled } });
    res.json({ enabled });
  });

  app.get("/api/ai-jobs", async (req, res) => {
    if (!await owner(req, res, requireOwner)) return;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const snap = await db.collection(JOBS).orderBy("createdAt", "desc").limit(limit).get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  });

  app.post("/api/ai-jobs", async (req, res) => {
    const actor = await owner(req, res, requireOwner);
    if (!actor) return;
    const type = String(req.body?.type || "");
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
    const policy = getAiJobPolicy(type);
    if (!policy) return res.status(400).json({ error: "Неизвестный тип задания" });
    if (!idempotencyKey || idempotencyKey.length > 200) return res.status(400).json({ error: "Нужен idempotencyKey" });
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) return res.status(413).json({ error: "Слишком большой payload" });
    const ref = db.collection(JOBS).doc(idFor(type, idempotencyKey));
    const result = await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (existing.exists) return { created: false, id: ref.id, status: existing.data()?.status };
      const status = initialAiJobStatus(policy.risk);
      transaction.create(ref, {
        type, payload, status, risk: policy.risk, idempotencyKey,
        attempts: 0, maxAttempts: policy.maxAttempts, timeoutMs: policy.timeoutMs,
        scheduledAt: Timestamp.now(), leaseUntil: null, leasedBy: null,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        createdBy: String(actor.email || actor.uid || "owner").slice(0, 200),
        approvalRequired: policy.risk === "APPROVAL", approvedAt: null, approvedBy: null,
      });
      return { created: true, id: ref.id, status };
    });
    await writeAudit(db, {
      actor: String(actor.email || actor.uid || "owner"), tool: "ai_jobs.enqueue",
      jobId: result.id, status: "success", result: { created: result.created, type, status: result.status },
    });
    res.status(result.created ? 201 : 200).json(result);
  });

  app.post("/api/ai-jobs/:id/approve", async (req, res) => {
    const actor = await owner(req, res, requireOwner);
    if (!actor) return;
    const ref = db.collection(JOBS).doc(req.params.id);
    const result = await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return "missing";
      if (!canApproveJob(snap.data()?.status)) return "invalid";
      transaction.update(ref, {
        status: "queued", approvedAt: FieldValue.serverTimestamp(),
        approvedBy: String(actor.email || actor.uid || "owner").slice(0, 200),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return "approved";
    });
    if (result === "missing") return res.status(404).json({ error: "Задание не найдено" });
    if (result === "invalid") return res.status(409).json({ error: "Задание нельзя подтвердить в текущем статусе" });
    await writeAudit(db, { actor: String(actor.email || actor.uid || "owner"), tool: "ai_jobs.approve", jobId: ref.id, status: "success" });
    res.json({ id: ref.id, status: "queued" });
  });

  app.post("/api/ai-jobs/:id/cancel", async (req, res) => {
    const actor = await owner(req, res, requireOwner);
    if (!actor) return;
    await db.collection(JOBS).doc(req.params.id).set({ status: "cancelled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await writeAudit(db, { actor: String(actor.email || actor.uid || "owner"), tool: "ai_jobs.cancel", jobId: req.params.id, status: "success" });
    res.json({ id: req.params.id, status: "cancelled" });
  });

  app.post("/api/ai-jobs/run", async (req, res) => {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const internalWorker = Boolean(options.workerSecret && bearer === options.workerSecret);
    if (!internalWorker && !await owner(req, res, requireOwner)) return;
    if (!await runtimeEnabled(db)) return res.status(423).json({ error: "AI kill switch выключен" });
    const workerId = `manual-${randomUUID()}`;
    const now = Timestamp.now();
    const candidates = await db.collection(JOBS).where("status", "in", ["queued", "retry_wait"]).limit(10).get();
    const ready = candidates.docs.filter(item => {
      const value = item.data().scheduledAt;
      return !value || value.toMillis() <= now.toMillis();
    });
    const results: Array<Record<string, unknown>> = [];
    for (const candidate of ready) {
      const claimed: Record<string, any> | null = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(candidate.ref);
        const data = fresh.data();
        if (!fresh.exists || !["queued", "retry_wait"].includes(data?.status)) return null;
        if (data?.approvalRequired && !data?.approvedAt) return null;
        transaction.update(candidate.ref, {
          status: "running", leasedBy: workerId,
          leaseUntil: Timestamp.fromMillis(Date.now() + Math.max(15_000, Number(data?.timeoutMs) + 5_000)),
          attempts: Number(data?.attempts || 0) + 1, updatedAt: FieldValue.serverTimestamp(),
        });
        return { ...data, attempts: Number(data?.attempts || 0) + 1 };
      });
      if (!claimed) continue;
      const executor = executors[claimed.type as AiJobType];
      try {
        if (!executor) throw new Error("Для типа задания ещё нет безопасного исполнителя");
        const output = await withTimeout(executor(claimed.payload || {}), Number(claimed.timeoutMs || 30_000));
        await candidate.ref.update({ status: "succeeded", result: output, finishedAt: FieldValue.serverTimestamp(), leaseUntil: null, leasedBy: null, updatedAt: FieldValue.serverTimestamp() });
        await writeAudit(db, { actor: workerId, tool: `ai_jobs.execute.${claimed.type}`, jobId: candidate.id, status: "success", result: { state: "succeeded" } });
        results.push({ id: candidate.id, status: "succeeded" });
      } catch (error) {
        const status = statusAfterFailure(claimed.attempts, Number(claimed.maxAttempts || 3));
        await candidate.ref.update({
          status, error: safeError(error), leaseUntil: null, leasedBy: null,
          scheduledAt: Timestamp.fromMillis(Date.now() + retryDelayMs(claimed.attempts)),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writeAudit(db, { actor: workerId, tool: `ai_jobs.execute.${claimed.type}`, jobId: candidate.id, status: "error", result: { state: status, error: safeError(error) } });
        if (status === "dead_letter" && options.notifyDeadLetter) {
          await options.notifyDeadLetter(`AI-задание ${candidate.id.slice(0, 12)} (${claimed.type}) перешло в DLQ после ${claimed.attempts} попыток.`).catch(() => undefined);
        }
        results.push({ id: candidate.id, status });
      }
    }
    res.json({ workerId, processed: results.length, results });
  });
}
