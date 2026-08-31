export const getExchangeOrderId = (orderId: string) => {
  const clean = String(orderId || '').trim();
  if (/E$/i.test(clean)) return clean.replace(/e$/i, 'E');
  if (/C$/i.test(clean)) return `${clean.slice(0, -1)}E`;
  return `${clean}E`;
};
