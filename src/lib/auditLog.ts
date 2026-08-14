import { auth } from '../firebase';

type AuditEntityType = 'order' | 'cdek' | 'client' | 'product' | 'finance' | string;

type AuditLogInput = {
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

const safeClone = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safeClone);
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (nested !== undefined) output[key] = safeClone(nested);
    });
    return output;
  }
  return value;
};

const buildShallowDiff = (before: unknown, after: unknown) => {
  const beforeObj = before && typeof before === 'object' ? before as Record<string, unknown> : {};
  const afterObj = after && typeof after === 'object' ? after as Record<string, unknown> : {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const diff: Record<string, { before: unknown; after: unknown }> = {};

  keys.forEach((key) => {
    const previous = safeClone(beforeObj[key]);
    const next = safeClone(afterObj[key]);
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      diff[key] = { before: previous, after: next };
    }
  });

  return diff;
};

export async function logAuditEvent(input: AuditLogInput) {
  try {
    const token = await auth.currentUser?.getIdToken().catch(() => '');
    await fetch('/api/audit/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...input,
        before: safeClone(input.before),
        after: safeClone(input.after),
        diff: buildShallowDiff(input.before, input.after),
        metadata: safeClone({
          ...(input.metadata || {}),
          path: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }),
    });
  } catch (error) {
    console.warn('[audit] Не удалось записать журнал действий:', error);
  }
}
