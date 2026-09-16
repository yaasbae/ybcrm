import { AppError } from "../utils/errors.js";

export const PERMISSIONS = [
  "crm.customers.read",
  "crm.orders.read",
  "crm.orders.write",
  "crm.payments.read",
  "crm.inventory.read",
  "crm.production.read",
  "crm.production.write",
  "crm.tasks.read",
  "crm.tasks.write",
  "crm.communications.read",
  "finance.read",
  "finance.prepare_payment",
  "finance.execute_payment",
  "telegram.read",
  "telegram.send",
  "supplier.read",
  "supplier.order",
  "content.create",
  "content.publish",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type ApprovalLevel = "SAFE" | "APPROVAL" | "FORBIDDEN";

export const READ_ONLY_PERMISSIONS: readonly Permission[] = [
  "crm.customers.read",
  "crm.orders.read",
  "crm.payments.read",
  "crm.inventory.read",
  "crm.production.read",
  "crm.tasks.read",
  "crm.communications.read",
  "finance.read",
  "telegram.read",
  "supplier.read",
];

export function permissionsForScopes(scope: string | undefined): Permission[] {
  const scopes = new Set(String(scope || "").split(/\s+/).filter(Boolean));
  if (!scopes.has("crm.read")) return [];
  return [...READ_ONLY_PERMISSIONS];
}

export function resolvePermissions(scope: string | undefined, claims: unknown): Permission[] {
  if (Array.isArray(claims)) {
    const allowed = new Set<string>(PERMISSIONS);
    return [...new Set(claims.map(String).filter((item): item is Permission => allowed.has(item)))];
  }
  return permissionsForScopes(scope);
}

export function requirePermission(granted: readonly Permission[], required: Permission): void {
  if (!granted.includes(required)) {
    throw new AppError(`Нет разрешения ${required}`, 403, "FORBIDDEN");
  }
}

export const ACTION_POLICY: Readonly<Record<string, ApprovalLevel>> = {
  "crm.customers.read": "SAFE",
  "crm.orders.read": "SAFE",
  "crm.payments.read": "SAFE",
  "crm.inventory.read": "SAFE",
  "crm.production.read": "SAFE",
  "crm.tasks.read": "SAFE",
  "crm.communications.read": "SAFE",
  "finance.read": "SAFE",
  "telegram.read": "SAFE",
  "supplier.read": "SAFE",
  "crm.orders.write": "APPROVAL",
  "crm.production.write": "APPROVAL",
  "crm.tasks.write": "APPROVAL",
  "finance.prepare_payment": "APPROVAL",
  "telegram.send": "APPROVAL",
  "supplier.order": "APPROVAL",
  "content.create": "APPROVAL",
  "content.publish": "APPROVAL",
  "finance.execute_payment": "FORBIDDEN",
  "system.delete_business_data": "FORBIDDEN",
  "system.change_permissions": "FORBIDDEN",
  "system.production_deploy": "FORBIDDEN",
  "system.change_critical_business_logic": "FORBIDDEN",
};
