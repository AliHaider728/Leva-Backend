import { calculateRoutineDiscount } from '../lib/routineDiscount.js';
import { resolveCartLine } from '../lib/pricingOffers.js';
import { getRoutineSettings } from './routineSettings.js';

export async function resolveRoutineOrder(conn: any, item: any) {
  if (typeof item.productId !== 'string' || !item.productId.startsWith('routine-') || item.productId.length > 255 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) throw new Error('Invalid routine entry.');
  if (!Array.isArray(item.routineComponents) || !item.routineComponents.length || item.routineComponents.length > 100) throw new Error('Choose between 1 and 100 routine products.');
  const seen = new Set<string>();
  const components = [];
  for (const input of item.routineComponents) {
    const key = `${input.productId}:${input.variationId || ''}`;
    if (!input.productId || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10000 || seen.has(key)) throw new Error('Invalid or duplicate routine product.');
    seen.add(key);
    const qty = input.quantity * item.quantity;
    if (!Number.isSafeInteger(qty)) throw new Error('Invalid routine quantity.');
    const [rows] = await conn.execute('SELECT id, name, price, stockQuantity, trackInventory, inStock, status, isVisible, productType, pricingOffers FROM products WHERE id = ? FOR UPDATE', [input.productId]);
    const p = rows[0];
    if (!p || p.status === 'draft' || p.isVisible === false || p.isVisible === 0 || p.productType === 'bundle') throw new Error('A routine product is no longer available.');
    let basePrice = Number(p.price);
    let variationId = null;
    let selectedVariant = null;
    let variantTracked = false;
    if (p.productType === 'variable') {
      const [variants] = await conn.execute('SELECT id, regularPrice, salePrice, enabled, manageStock, stockQuantity, stockStatus, attributes FROM product_variants WHERE id = ? AND product_id = ? FOR UPDATE', [input.variationId || '', p.id]);
      const v = variants[0];
      if (!v || !v.enabled || v.stockStatus === 'out_of_stock' || (v.manageStock && Number(v.stockQuantity) < qty)) throw new Error(`Choose an available option for ${p.name}.`);
      basePrice = Number(v.salePrice ?? v.regularPrice);
      variationId = v.id;
      const attributes = typeof v.attributes === 'string' ? JSON.parse(v.attributes) : v.attributes;
      selectedVariant = Object.entries(attributes || {}).map(([k, value]) => `${k}: ${value}`).join(', ');
      variantTracked = Boolean(v.manageStock);
    } else if (!p.inStock || (p.trackInventory && Number(p.stockQuantity) < qty)) throw new Error(`${p.name} does not have enough stock.`);
    const offers = typeof p.pricingOffers === 'string' ? JSON.parse(p.pricingOffers) : p.pricingOffers;
    const unitPrice = resolveCartLine(offers, basePrice, input.quantity).unitPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid routine product price.');
    // Reserve inside the order transaction, including shared products across routines.
    if (variantTracked) {
      const [result] = await conn.execute('UPDATE product_variants SET stockQuantity = stockQuantity - ? WHERE id = ? AND stockQuantity >= ?', [qty, variationId, qty]);
      if (!result.affectedRows) throw new Error(`${p.name} ran out of stock.`);
    } else if (p.productType !== 'variable' && p.trackInventory) {
      const [result] = await conn.execute('UPDATE products SET stockQuantity = stockQuantity - ?, updatedAt = NOW() WHERE id = ? AND stockQuantity >= ?', [qty, p.id, qty]);
      if (!result.affectedRows) throw new Error(`${p.name} ran out of stock.`);
    }
    components.push({ productId: p.id, name: p.name, quantity: input.quantity, unitPrice, variationId, selectedVariant, trackInventory: p.productType !== 'variable' && Boolean(p.trackInventory), variantTracked });
  }
  const totals = calculateRoutineDiscount(components, await getRoutineSettings(conn));
  if (!Number.isFinite(Number(item.price)) || Math.abs(Number(item.price) - totals.total) > 0.02) throw new Error('Routine prices or savings changed. Rebuild your routine and try again.');
  return { productId: item.productId, productName: `Custom Routine (${totals.totalQuantity} items)`, quantity: item.quantity, price: totals.total, image: item.image || null, selectedVariant: null, variationId: null, trackInventory: false, productType: 'bundle', isRoutine: true, routineComponents: components };
}

export function readRoutineComponents(value: unknown): any[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

export async function restoreRoutineStock(conn: any, item: any) {
  const components = readRoutineComponents(item.routineComponents);
  for (const c of components) {
    const qty = c.quantity * item.quantity;
    if (c.variantTracked) await conn.execute('UPDATE product_variants SET stockQuantity = stockQuantity + ? WHERE id = ?', [qty, c.variationId]);
    else if (c.trackInventory) await conn.execute('UPDATE products SET stockQuantity = stockQuantity + ?, updatedAt = NOW() WHERE id = ?', [qty, c.productId]);
  }
  return components.length > 0;
}
