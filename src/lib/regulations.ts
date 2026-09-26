export type RegulationBlockData = {
  title: string;
  description?: string;
  steps: string[];
  note?: string;
};

export type RegulationData = {
  id: string;
  group: string;
  title: string;
  summary: string;
  blocks: RegulationBlockData[];
  updatedAt?: string;
  updatedBy?: string;
};

const cleanText = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

export function normalizeRegulation(value: unknown): RegulationData {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const blocks = Array.isArray(source.blocks) ? source.blocks.slice(0, 20).map((item) => {
    const block = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      title: cleanText(block.title, 120),
      description: cleanText(block.description, 1200) || undefined,
      steps: (Array.isArray(block.steps) ? block.steps : [])
        .slice(0, 30)
        .map((step) => cleanText(step, 600))
        .filter(Boolean),
      note: cleanText(block.note, 1200) || undefined,
    };
  }) : [];
  return {
    id: cleanText(source.id, 80).toLowerCase(),
    group: cleanText(source.group, 80),
    title: cleanText(source.title, 140),
    summary: cleanText(source.summary, 500),
    blocks,
  };
}

export function validateRegulation(value: unknown) {
  const regulation = normalizeRegulation(value);
  const errors: string[] = [];
  if (!/^[a-z0-9-]{2,80}$/.test(regulation.id)) errors.push('Некорректный идентификатор регламента');
  if (!regulation.group) errors.push('Укажите раздел');
  if (!regulation.title) errors.push('Укажите название');
  if (!regulation.summary) errors.push('Укажите краткое описание');
  if (regulation.blocks.length === 0) errors.push('Добавьте хотя бы один блок');
  regulation.blocks.forEach((block, index) => {
    if (!block.title) errors.push(`Укажите название блока ${index + 1}`);
    if (block.steps.length === 0) errors.push(`Добавьте шаги в блок ${index + 1}`);
  });
  return { regulation, errors };
}

export function createRegulationId(title: string, existingIds: string[]) {
  const transliteration: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const base = title.toLowerCase().split('').map((letter) => transliteration[letter] ?? letter).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55) || 'regulation';
  let candidate = base;
  let suffix = 2;
  while (existingIds.includes(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}
