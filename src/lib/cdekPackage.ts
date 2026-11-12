export type CdekCatalogProduct = {
  name: string;
  weight?: string | number;
};

export type CdekPackageWeight = {
  weight: number;
  missingItems: string[];
  fallbackCount: number;
};

const normalizeName = (value: unknown) => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');

export function parseProductWeightGrams(value: unknown): number | null {
  const raw = String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(',', '.');
  if (!raw) return null;
  const amount = Number(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const grams = /(?:кг|kg)/.test(raw) ? amount * 1000 : amount;
  return Math.round(grams);
}

export function calculateCdekPackageWeight(
  itemNames: string[],
  products: CdekCatalogProduct[],
  fallbackPerItem = 700,
  minimumPackageWeight = 1500,
): CdekPackageWeight {
  const items = itemNames.map(item => String(item || '').trim()).filter(Boolean);
  if (!items.length) return { weight: minimumPackageWeight, missingItems: [], fallbackCount: 1 };

  const productByName = new Map(products.map(product => [normalizeName(product.name), product]));
  const missingItems: string[] = [];
  let fallbackCount = 0;
  let weight = 0;
  for (const item of items) {
    const productWeight = parseProductWeightGrams(productByName.get(normalizeName(item))?.weight);
    if (productWeight) {
      weight += productWeight;
    } else {
      weight += fallbackPerItem;
      fallbackCount += 1;
      missingItems.push(item);
    }
  }
  return { weight: Math.max(minimumPackageWeight, weight), missingItems, fallbackCount };
}
