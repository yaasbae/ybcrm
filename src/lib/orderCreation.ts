export type OrderCreationMode = 'create' | 'reuse_deleted' | 'conflict';

export const getOrderCreationMode = (
  existingOrder: Record<string, unknown> | null,
): OrderCreationMode => {
  if (!existingOrder) return 'create';
  return existingOrder.deleted === true ? 'reuse_deleted' : 'conflict';
};
