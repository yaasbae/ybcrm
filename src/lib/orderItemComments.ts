export type OrderLine = { name: string; color: string; size: string; height: string };
export type OrderWithItemComments = {
  item?: string; items?: string[]; itemColors?: string[]; itemSizes?: string[];
  itemHeights?: string[]; itemComments?: string[];
};

export class ItemCommentError extends Error {}

export function orderLines(order: OrderWithItemComments): OrderLine[] {
  const names = Array.isArray(order.items) && order.items.length
    ? order.items : String(order.item || '').split(/\s*,\s*|\n/).filter(Boolean);
  return names.map((name, index) => ({
    name: String(name || '').trim(),
    color: String(order.itemColors?.[index] || ''),
    size: String(order.itemSizes?.[index] || ''),
    height: String(order.itemHeights?.[index] || ''),
  }));
}

export function buildItemCommentPatch(order: OrderWithItemComments, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ItemCommentError('Проверьте комментарий.');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['itemIndex', 'line', 'previousComment', 'comment'].includes(key))
    || !Number.isInteger(data.itemIndex) || Number(data.itemIndex) < 0 || Number(data.itemIndex) > 99
    || typeof data.comment !== 'string' || data.comment.length > 1000
    || typeof data.previousComment !== 'string' || !data.line || typeof data.line !== 'object' || Array.isArray(data.line)) {
    throw new ItemCommentError('Проверьте комментарий: не больше 1000 символов.');
  }
  const index = Number(data.itemIndex);
  const line = orderLines(order)[index];
  const expected = data.line as Record<string, unknown>;
  if (!line?.name || Object.keys(line).some(key => line[key as keyof OrderLine] !== expected[key])) {
    throw new ItemCommentError('Товар изменился. Обновите заказ перед сохранением комментария.');
  }
  const previous = String(order.itemComments?.[index] || '');
  if (previous !== data.previousComment) throw new ItemCommentError('Комментарий уже изменён другим сотрудником. Обновите заказ.');
  const comment = data.comment.trim();
  if (previous === comment) return null;
  return { itemComments: orderLines(order).map((_, itemIndex) => itemIndex === index ? comment : String(order.itemComments?.[itemIndex] || '')) };
}
