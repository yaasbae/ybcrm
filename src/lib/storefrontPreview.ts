/** Only these storefront reads are safe in the local preview server. */
export function isStorefrontPreviewRequestAllowed(method: string, path: string): boolean {
  return (method === 'GET' && ['/storefront/bootstrap', '/storefront/cdek/cities', '/storefront/cdek/points'].includes(path))
    || (method === 'POST' && path === '/storefront/cdek/calculate');
}
