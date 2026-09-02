export type ProductMaterial = {
  id: string;
  name: string;
  composition: string;
};

export const DEFAULT_PRODUCT_MATERIALS: ProductMaterial[] = [
  { id: 'main', name: 'Основная ткань', composition: '' },
  { id: 'insulation', name: 'Утеплитель', composition: '' },
  { id: 'lining', name: 'Подкладочная ткань', composition: '' },
];

const cleanMaterial = (value: unknown): ProductMaterial | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<ProductMaterial>;
  const id = String(item.id || '').trim();
  const name = String(item.name || '').trim();
  const composition = String(item.composition || '').trim();
  if (!id && !name && !composition) return null;
  return { id: id || `material-${name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}`, name, composition };
};

export const ensureProductMaterials = (value: unknown, legacyComposition = ''): ProductMaterial[] => {
  const incoming = Array.isArray(value) ? value.map(cleanMaterial).filter(Boolean) as ProductMaterial[] : [];
  const used = new Set<string>();
  const defaults = DEFAULT_PRODUCT_MATERIALS.map((fallback, index) => {
    const match = incoming.find(item => item.id === fallback.id)
      || incoming.find(item => !used.has(item.id) && item.name.toLowerCase() === fallback.name.toLowerCase());
    if (match) used.add(match.id);
    return {
      id: fallback.id,
      name: match?.name || fallback.name,
      composition: match?.composition || (index === 0 ? String(legacyComposition || '').trim() : ''),
    };
  });
  const extra = incoming.filter(item => !used.has(item.id) && !DEFAULT_PRODUCT_MATERIALS.some(defaultItem => defaultItem.id === item.id));
  return [...defaults, ...extra];
};

export const getPrimaryComposition = (materials: unknown, legacyComposition = '') =>
  ensureProductMaterials(materials, legacyComposition)[0]?.composition || String(legacyComposition || '').trim();

export const formatProductMaterials = (materials: unknown, legacyComposition = '') =>
  ensureProductMaterials(materials, legacyComposition)
    .filter(item => item.composition)
    .map(item => `${item.name}: ${item.composition}`)
    .join('; ');

