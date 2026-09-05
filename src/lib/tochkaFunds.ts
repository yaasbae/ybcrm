export const TOCHKA_FUND_NAMES: Record<string, string> = {
  '8662': 'Возврат займа',
  '8606': 'Собственник Анна',
  '8615': 'Ткань и фурнитура',
  '8654': 'Аутсорс',
  '8607': 'Собственник Дмитрий',
  '8630': 'СДЭК',
  '8619': 'Процент менеджеру',
  '5165': 'Налоги',
  '4118': 'Подушка семьи',
};

export function getTochkaFundName(accountId: unknown): string | null {
  const accountNumber = String(accountId || '').split('/')[0].replace(/\D/g, '');
  if (!accountNumber) return null;
  const suffix = Object.keys(TOCHKA_FUND_NAMES).find(key => accountNumber.endsWith(key));
  return suffix ? TOCHKA_FUND_NAMES[suffix] : null;
}
