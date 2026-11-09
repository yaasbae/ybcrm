export function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replace(/[\s\u00a0]/g, '').replace(/₽/g, '');
  if (!normalized) return null;
  if (!/^[+-]?[\d.,]+$/.test(normalized)) return Number.NaN;

  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^[+-]/, '');
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');
  const separatorIndex = Math.max(lastComma, lastDot);
  const separator = separatorIndex >= 0 ? unsigned[separatorIndex] : '';
  const fractionalDigits = separatorIndex >= 0 ? unsigned.length - separatorIndex - 1 : 0;
  const sameSeparatorCount = separator ? unsigned.split(separator).length - 1 : 0;
  const isThousandsGrouping = separatorIndex >= 0
    && fractionalDigits === 3
    && (sameSeparatorCount > 1 || separatorIndex >= 1);

  const numeric = isThousandsGrouping
    ? unsigned.replace(/[.,]/g, '')
    : separatorIndex >= 0
      ? `${unsigned.slice(0, separatorIndex).replace(/[.,]/g, '')}.${unsigned.slice(separatorIndex + 1).replace(/[.,]/g, '')}`
      : unsigned;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? sign * parsed : Number.NaN;
}

export function formatMoneyInput(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
