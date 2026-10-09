// Keep this pure module identical in the independently deployed frontend/backend.
export interface RoutineDiscountSettings {
  minimumDistinctProducts: number;
  tiers: { minProducts: number; discountPercent: number }[];
  quantityBonusEnabled: boolean;
  quantityBonusPercent: number;
}

export const DEFAULT_ROUTINE_DISCOUNT: RoutineDiscountSettings = {
  minimumDistinctProducts: 2,
  tiers: [{ minProducts: 2, discountPercent: 10 }, { minProducts: 3, discountPercent: 15 }],
  quantityBonusEnabled: true,
  quantityBonusPercent: 5,
};

export function validateRoutineSettings(input: unknown): RoutineDiscountSettings {
  const value = input as RoutineDiscountSettings;
  if (!value || !Number.isInteger(value.minimumDistinctProducts) || value.minimumDistinctProducts < 1 || value.minimumDistinctProducts > 100) {
    throw new Error('Minimum distinct products must be a whole number between 1 and 100.');
  }
  if (typeof value.quantityBonusEnabled !== 'boolean' || !Number.isFinite(value.quantityBonusPercent) || value.quantityBonusPercent < 0 || value.quantityBonusPercent > 100) {
    throw new Error('Quantity bonus must be between 0% and 100%.');
  }
  if (!Array.isArray(value.tiers) || !value.tiers.length || value.tiers.length > 100) {
    throw new Error('Add at least one discount tier (up to 100).');
  }
  const counts = new Set<number>();
  const tiers = value.tiers.map(tier => {
    if (!tier || !Number.isInteger(tier.minProducts) || tier.minProducts < 1 || tier.minProducts > 100 || counts.has(tier.minProducts)) {
      throw new Error('Each tier needs a unique whole product count between 1 and 100.');
    }
    counts.add(tier.minProducts);
    if (!Number.isFinite(tier.discountPercent) || tier.discountPercent < 0 || tier.discountPercent + (value.quantityBonusEnabled ? value.quantityBonusPercent : 0) > 100) {
      throw new Error('Each tier plus the enabled quantity bonus must be between 0% and 100%.');
    }
    return { minProducts: tier.minProducts, discountPercent: tier.discountPercent };
  }).sort((a, b) => a.minProducts - b.minProducts);
  return { minimumDistinctProducts: value.minimumDistinctProducts, tiers, quantityBonusEnabled: value.quantityBonusEnabled, quantityBonusPercent: value.quantityBonusPercent };
}

export function normalizeRoutineSettings(value: unknown): RoutineDiscountSettings {
  try { return validateRoutineSettings(value); }
  catch { return validateRoutineSettings(DEFAULT_ROUTINE_DISCOUNT); }
}

export interface RoutineLine { productId: string; quantity: number; unitPrice: number }
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateRoutineDiscount(lines: RoutineLine[], input?: RoutineDiscountSettings) {
  const settings = normalizeRoutineSettings(input);
  const validLines = lines.filter(line => line.productId && Number.isInteger(line.quantity) && line.quantity > 0 && Number.isFinite(line.unitPrice) && line.unitPrice >= 0);
  const distinctCount = new Set(validLines.map(line => line.productId)).size;
  const totalQuantity = validLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = roundMoney(validLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const tier = [...settings.tiers].reverse().find(tier => distinctCount >= tier.minProducts);
  const eligible = distinctCount >= settings.minimumDistinctProducts && Boolean(tier);
  const tierPercent = eligible ? tier!.discountPercent : 0;
  // Distinct product IDs, never variant/line count; the quantity bonus applies once.
  const bonusPercent = eligible && totalQuantity > distinctCount && settings.quantityBonusEnabled ? settings.quantityBonusPercent : 0;
  const percent = Math.min(100, roundMoney(tierPercent + bonusPercent));
  // Storefront prices display whole PKR. Round savings once before subtracting,
  // so the displayed subtotal minus savings always agrees with the total.
  const savings = Math.round(subtotal * percent / 100);
  return { distinctCount, totalQuantity, subtotal, tierPercent, bonusPercent, percent, savings, total: roundMoney(subtotal - savings), eligible };
}
