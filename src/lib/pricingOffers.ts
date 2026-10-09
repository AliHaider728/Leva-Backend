/**
 * pricingOffers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side helper that resolves the effective unit price and BOGO free-unit
 * count for a cart line.  This is the canonical pricing logic and MUST be run
 * on the server at order-creation time.  Never trust prices sent from the
 * browser.
 *
 * Precedence (both can be active simultaneously):
 *   1. Quantity Breaks — determines the effective unit price
 *   2. BOGO            — adds free units on top of the discounted price
 *
 * BOGO free-unit calculation (per the approved Q3 decision):
 *   freeUnits = floor(quantity / buyQty) * getQty
 *   So buying 4 units on a "Buy 2 Get 1" offer yields 2 free units.
 *
 * Stock implications (per the approved Q2 decision):
 *   When trackInventory is true, the caller must decrement stock by
 *   (quantity + freeUnits), not just quantity.
 */

export interface QuantityBreakTier {
  minQty: number;
  pricePerUnit: number;
  label: string;
  badge: string;
}

export interface QuantityBreaks {
  enabled: boolean;
  tiers: QuantityBreakTier[];
}

export interface Bogo {
  enabled: boolean;
  buyQty: number;
  getQty: number;
  label: string;
}

export interface FlatDiscount {
  enabled: boolean;
  minQty: number;
  discountType: "fixed" | "percentage";
  discountValue: number;
  label: string;
}

export interface PricingOffers {
  quantityBreaks?: QuantityBreaks;
  bogo?: Bogo;
  flatDiscount?: FlatDiscount;
}

export interface CartLineResult {
  /** Effective price per paid unit after QB (may equal baseUnitPrice when QB is inactive) */
  unitPrice: number;
  /** Number of additional free units awarded by BOGO.  0 when BOGO is inactive. */
  freeUnits: number;
  /**
   * Total charge = unitPrice × quantity  (free units are not charged).
   * Stock deduction = quantity + freeUnits when trackInventory is true.
   */
  totalPrice: number;
  /** Human-readable label(s) of the applied offer(s), empty string when none. */
  appliedLabel: string;
}

/**
 * Resolve the effective pricing for one cart line.
 *
 * @param pricingOffers  The pricingOffers field from the product document.
 * @param baseUnitPrice  The price that would be charged without any offers
 *                       (e.g. variation's salePrice or product.price + variant offset).
 * @param quantity       The paid quantity the customer is purchasing (>= 1).
 */
export const resolveCartLine = (
  pricingOffers: PricingOffers | undefined | null,
  baseUnitPrice: number,
  quantity: number
): CartLineResult => {
  let unitPrice = baseUnitPrice;
  let freeUnits = 0;
  const labels: string[] = [];

  // ── 1. Quantity Breaks ────────────────────────────────────────────────────
  const qb = pricingOffers?.quantityBreaks;
  let qbMatched = false;
  
  if (qb?.enabled && Array.isArray(qb.tiers) && qb.tiers.length > 0) {
    // Sort descending by minQty so we pick the highest qualifying tier
    const sortedTiers = [...qb.tiers].sort((a, b) => b.minQty - a.minQty);
    const lowestTier = sortedTiers[sortedTiers.length - 1];
    const tier1Price = (lowestTier && lowestTier.minQty === 1) ? lowestTier.pricePerUnit : baseUnitPrice;
    
    const matchedTier = sortedTiers.find(tier => quantity >= tier.minQty);
    if (matchedTier) {
      qbMatched = true;
      unitPrice = matchedTier.pricePerUnit;
      
      const savePct = matchedTier.pricePerUnit < tier1Price ? 1 : 0;
      const savedAmount = (tier1Price - matchedTier.pricePerUnit) * matchedTier.minQty;
      
      const autoLabel = savePct > 0 
        ? `Buy ${matchedTier.minQty}, Save Rs. ${savedAmount}` 
        : `Buy ${matchedTier.minQty}`;
        
      labels.push(matchedTier.label || autoLabel);
    }
  }
  
  if (!qbMatched) {
    // 2. Flat Discount logic (only applies if Quantity Breaks didn't match a tier)
    const flat = pricingOffers?.flatDiscount;
    if (flat?.enabled && quantity >= flat.minQty) {
      if (flat.discountType === 'percentage') {
        const discountAmount = baseUnitPrice * (flat.discountValue / 100);
        unitPrice = Math.max(0, baseUnitPrice - discountAmount);
      } else {
        unitPrice = Math.max(0, baseUnitPrice - flat.discountValue);
      }

      const flatSavedAmount = baseUnitPrice - unitPrice;
      const flatAutoLabel = flat.discountType === 'percentage'
        ? `Buy ${flat.minQty}+, Save ${flat.discountValue}%/unit`
        : `Buy ${flat.minQty}+, Save Rs. ${flatSavedAmount}/unit`;

      if (flatSavedAmount > 0) {
        labels.push(flat.label || flatAutoLabel);
      }
    }
  }

  // ── 3. BOGO ───────────────────────────────────────────────────────────────
  const bogo = pricingOffers?.bogo;
  if (bogo?.enabled && bogo.buyQty >= 1 && bogo.getQty >= 1) {
    // Repeat the offer: floor(quantity / buyQty) × getQty
    freeUnits = Math.floor(quantity / bogo.buyQty) * bogo.getQty;
    if (freeUnits > 0) {
      const bogoLabel = bogo.label || `Buy ${bogo.buyQty} Get ${bogo.getQty} Free`;
      labels.push(
        freeUnits === 1
          ? `${bogoLabel} (${freeUnits} free unit applied)`
          : `${bogoLabel} (${freeUnits} free units applied)`
      );
    }
  }

  return {
    unitPrice,
    freeUnits,
    totalPrice: unitPrice * quantity,
    appliedLabel: labels.join(' · ')
  };
};
