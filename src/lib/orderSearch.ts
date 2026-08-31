const normalizeSearchValue = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim();

const getSearchFields = (order: Record<string, any>) => [
  order.orderId,
  order.clientName,
  order.clientPhone,
  order.clientInsta,
  order.clientCity,
  order.clientAddress,
  order.item,
  ...(Array.isArray(order.items) ? order.items : []),
  order.blogger,
  order.manager,
  order.cdekNumber,
];

export const matchesOrderSearch = (order: Record<string, any>, query: string) => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  const fields = getSearchFields(order).map(normalizeSearchValue);
  const combined = fields.join(' ');
  const phoneDigits = String(order.clientPhone ?? '').replace(/\D/g, '');
  const queryDigits = normalizedQuery.replace(/\D/g, '');
  const tokens = normalizedQuery.split(' ').filter(Boolean);

  const textMatch = tokens.every(token => combined.includes(token));
  const phoneMatch = queryDigits.length >= 3 && phoneDigits.includes(queryDigits);
  return textMatch || phoneMatch;
};
