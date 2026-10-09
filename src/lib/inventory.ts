export type StockStatus = 'in_stock' | 'out_of_stock';

export interface NormalizedInventory {
  trackInventory: boolean;
  stockQuantity?: number;
  stockStatus: StockStatus;
  inStock: boolean;
  lowStockThreshold?: number;
}

const hasValidQuantity = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  String(value).trim() !== '' &&
  Number.isInteger(Number(value)) &&
  Number(value) >= 0;

const optionalNonNegativeInteger = (value: unknown): number | undefined =>
  hasValidQuantity(value) ? Number(value) : undefined;

export const normalizeInventory = (value: Record<string, any>): NormalizedInventory => {
  const quantity = optionalNonNegativeInteger(value.stockQuantity);
  const trackInventory = typeof value.trackInventory === 'boolean'
    ? value.trackInventory
    : quantity !== undefined;

  if (trackInventory) {
    const trackedQuantity = quantity ?? 0;
    const inStock = trackedQuantity > 0;
    return {
      trackInventory: true,
      stockQuantity: trackedQuantity,
      stockStatus: inStock ? 'in_stock' : 'out_of_stock',
      inStock,
      lowStockThreshold: optionalNonNegativeInteger(value.lowStockThreshold)
    };
  }

  const stockStatus: StockStatus = value.stockStatus === 'out_of_stock' || value.inStock === false
    ? 'out_of_stock'
    : 'in_stock';
  return {
    trackInventory: false,
    stockStatus,
    inStock: stockStatus === 'in_stock'
  };
};

export const hasVariantGroups = (product: Record<string, any>): boolean =>
  Array.isArray(product.variants) &&
  product.variants.some((group: any) => Array.isArray(group?.options) && group.options.length > 0);
