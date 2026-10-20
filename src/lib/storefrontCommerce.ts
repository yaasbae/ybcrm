export type StorefrontCartInput = {
  productId: string;
  quantity: number;
  size?: string;
  fit?: string;
};

export function isStorefrontSizeAvailable(sizeGrid: string, selected: string | undefined): boolean {
  const sizes = sizeGrid.split(/[,;.•/|\n]+/).map(value => value.trim()).filter(value => value.length > 0 && value.length <= 40);
  return Boolean(selected && sizes.includes(selected));
}

export type StorefrontProductSource = {
  id?: string;
  name?: string;
  sellingPrice?: number;
  photos?: string[];
  storefrontPhotos?: string[];
  color?: string;
  sizeGrid?: string;
  applicationType?: string;
  description?: string;
  collectionName?: string;
  seasonality?: string;
  sizeDetails?: string;
  composition?: string;
  materials?: unknown[];
  countryOfOrigin?: string;
  storefrontPublished?: boolean;
  storefrontCategory?: string;
  stockQuantity?: number | null;
  reservedQuantity?: number | null;
};

export function sanitizeStorefrontProduct(id: string, source: StorefrontProductSource) {
  const name = String(source.name || '').trim();
  const price = Math.max(0, Math.round((Number(source.sellingPrice) || 0) * 100) / 100);
  const photoSource = Array.isArray(source.storefrontPhotos) && source.storefrontPhotos.length
    ? source.storefrontPhotos
    : source.photos;
  const photos = Array.isArray(photoSource)
    ? photoSource.map(value => String(value || '').trim()).filter(value => /^https:\/\//i.test(value)).slice(0, 12)
    : [];
  if (source.storefrontPublished === false || !name || !Number.isFinite(price) || price <= 0 || !photos.length) return null;
  return {
    id: String(source.id || id).trim() || id,
    name,
    price,
    photos,
    color: String(source.color || '').trim(),
    sizeGrid: String(source.sizeGrid || '').trim(),
    category: String(source.storefrontCategory || 'Коллекция').trim() || 'Коллекция',
    description: String(source.description || '').trim(),
    collectionName: String(source.collectionName || '').trim(),
    seasonality: String(source.seasonality || '').trim(),
    sizeDetails: String(source.sizeDetails || '').trim(),
    composition: String(source.composition || '').trim(),
    materials: Array.isArray(source.materials) ? source.materials.slice(0, 12)
      .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
      .map(value => ({
        id: typeof value.id === 'string' ? value.id.slice(0, 160) : '',
        name: typeof value.name === 'string' ? value.name.slice(0, 160) : '',
        composition: typeof value.composition === 'string' ? value.composition.slice(0, 1000) : '',
      })) : [],
    countryOfOrigin: String(source.countryOfOrigin || '').trim(),
    availability: typeof source.stockQuantity === 'number' && Number.isFinite(source.stockQuantity)
      ? source.stockQuantity - (typeof source.reservedQuantity === 'number' && Number.isFinite(source.reservedQuantity) ? Math.max(0, source.reservedQuantity) : 0) > 0
        ? 'in_stock' : 'made_to_order'
      : 'unknown',
  };
}

export function normalizeStorefrontCart(value: unknown): StorefrontCartInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      productId: String(row.productId || '').trim().slice(0, 160),
      quantity: Math.max(1, Math.min(20, Math.floor(Number(row.quantity) || 1))),
      size: String(row.size || '').trim().slice(0, 40),
      fit: String(row.fit || '').trim().slice(0, 60),
    };
  }).filter(item => item.productId);
}

export function normalizeStorefrontPhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

export function isStorefrontEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

const STOREFRONT_SETTING_KEYS = [
  'storeUrl', 'logoUrl', 'announcementText', 'announcementEnabled', 'menu',
  'heroSlides', 'heroItems', 'lookbook', 'popular', 'about', 'campaign',
  'articlesTitle', 'articles', 'pages', 'footer', 'seo', 'featuredProductIds',
] as const;

export function sanitizeStorefrontSettings(source: unknown) {
  if (!source || typeof source !== 'object') return {};
  const input = source as Record<string, unknown>;
  return Object.fromEntries(STOREFRONT_SETTING_KEYS
    .filter(key => input[key] !== undefined)
    .map(key => [key, input[key]]));
}
