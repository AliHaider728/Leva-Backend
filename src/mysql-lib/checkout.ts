import { ClientError } from '../lib/httpError.js';
import { resolveCartLine } from '../lib/pricingOffers.js';
import { roundMoney, calculateRoutineDiscount } from '../lib/routineDiscount.js';
import { getRoutineSettings } from './routineSettings.js';
import { resolveRoutineOrder } from './routineOrders.js';
import { getFeatures, type Features } from '../config/features.js';
const bool = (value: any) => value === true || value === 1 || value === '1';
const parse = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
const amount = (value: any) => {
    const n = Number(value); if (!Number.isFinite(n) || n < 0)
        throw new ClientError('A stored price is invalid. Please contact support.', 503); return n;
};
export function bundlePrice(bundle: any, subtotal: number) {
    const discount = amount(bundle.discountValue ?? bundle.discountPercent ?? 0); let price = subtotal; if (bundle.discountType === 'percentage' || !bundle.discountType)
        price = subtotal * (1 - Math.min(100, Number(bundle.discountValue || bundle.discountPercent || 0)) / 100);
    else if (bundle.discountType === 'fixed')
        price = Math.max(0, subtotal - discount);
    else if (bundle.discountType === 'custom')
        price = amount(bundle.customPrice ?? bundle.bundlePrice ?? subtotal); return roundMoney(amount(price));
}
export function couponSavings(coupon: any, subtotal: number) {
    if (!coupon || !bool(coupon.isActive) || subtotal < amount(coupon.minPurchase || 0) || (coupon.usageLimit != null && Number(coupon.usageCount) >= Number(coupon.usageLimit)))
        throw new ClientError('Your coupon is no longer valid.'); const value = amount(coupon.discountValue); if (!['percentage', 'fixed', 'flat'].includes(coupon.discountType))
        throw new ClientError('Your coupon is no longer valid.'); return roundMoney(Math.min(subtotal, coupon.discountType === 'percentage' ? subtotal * Math.min(value, 100) / 100 : value));
}
async function reserve(conn: any, product: any, qty: number, variant: any = null) {
    const row = variant || product; const tracked = bool(variant ? row.manageStock : row.trackInventory); if ((variant && (!bool(row.enabled) || row.stockStatus === 'out_of_stock')) || (!variant && !bool(product.inStock)) || (tracked && Number(row.stockQuantity) < qty))
        throw new ClientError(product.name + ' is out of stock.'); if (tracked) {
            const table = variant ? 'product_variants' : 'products';
            const [result] = await conn.execute('UPDATE ' + table + ' SET stockQuantity=stockQuantity-? WHERE id=? AND stockQuantity>=?', [qty, row.id, qty]);
            if (!result.affectedRows)
                throw new ClientError(product.name + ' ran out of stock.');
        } return tracked;
}
async function productLine(conn: any, input: any, qty: number, features: Features) {
    const [rows] = await conn.execute('SELECT id,name,price,inStock,trackInventory,stockQuantity,status,isVisible,productType,pricingOffers FROM products WHERE id=? FOR UPDATE', [input.productId]); const product = rows[0]; if (!product || product.status === 'draft' || !bool(product.isVisible))
        throw new ClientError('A product is no longer available.'); let variant: any = null; let base = amount(product.price); if (product.productType === 'variable') {
            if (!features.variants)
                throw new ClientError('Variants are not available.', 404);
            const [variants] = await conn.execute('SELECT id,regularPrice,salePrice,enabled,manageStock,stockQuantity,stockStatus,attributes FROM product_variants WHERE id=? AND product_id=? FOR UPDATE', [input.variationId || '', product.id]);
            variant = variants[0];
            if (!variant)
                throw new ClientError('Choose a valid product option.');
            base = amount(variant.salePrice ?? variant.regularPrice);
        } const pricing = resolveCartLine(parse(product.pricingOffers), base, qty); const quantity = qty + Number(pricing.freeUnits || 0); if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw new ClientError('Invalid product quantity.'); const tracked = await reserve(conn, product, quantity, variant); return { product, variant, price: roundMoney(amount(pricing.unitPrice)), component: { productId: product.id, name: product.name, quantity, unitPrice: roundMoney(amount(pricing.unitPrice)), variationId: variant?.id || null, trackInventory: !variant && tracked, variantTracked: !!variant && tracked } };
}
export async function calculateCheckout(conn: any, items: any[], couponCode: string) {
    const features = await getFeatures(conn);
    const canonicalItems: any[] = [];
    let subtotal = 0;
    for (const input of items) {
        if (!input || typeof input.productId !== 'string' || input.productId.length > 255 || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000)
            throw new ClientError('Invalid item in order.');
        const qty = input.quantity;
        if (input.routineComponents !== undefined) {
            if (!features.routineBuilder)
                throw new ClientError('Routine builder is not available.', 404);
            const line = await resolveRoutineOrder(conn, input, features);
            canonicalItems.push(line);
            subtotal += line.price * line.quantity;
            continue;
        }
        if (input.isRoutine === true && !features.routineBuilder)
            throw new ClientError('Routine builder is not available.', 404);
        if (input.productType === 'bundle') {
            if (!features.bundles)
                throw new ClientError('Bundles are not available.', 404);
            const [rows] = await conn.execute('SELECT id,name,bundlePrice,customPrice,discountType,discountValue,discountPercent,isActive FROM bundles WHERE id=? FOR UPDATE', [input.productId]);
            const bundle = rows[0];
            if (!bundle || !bool(bundle.isActive))
                throw new ClientError('A bundle is no longer available.');
            const [children] = await conn.execute('SELECT product_id,quantity FROM bundle_products WHERE bundle_id=? ORDER BY product_id', [bundle.id]);
            if (!children.length)
                throw new ClientError('A bundle has no products.');
            const components: any[] = [];
            let original = 0;
            for (const child of children) {
                if (!Number.isInteger(Number(child.quantity)) || Number(child.quantity) < 1)
                    throw new ClientError('A bundle quantity is invalid.', 503);
                const line = await productLine(conn, { productId: child.product_id }, Number(child.quantity) * qty, features);
                if (line.variant)
                    throw new ClientError('A bundle component needs a fixed product option.');
                original += amount(line.product.price) * Number(child.quantity);
                components.push({ ...line.component, source: 'bundle', quantity: line.component.quantity / qty });
            }
            const price = bundlePrice(bundle, original);
            canonicalItems.push({ productId: bundle.id, productName: bundle.name, quantity: qty, price, image: null, selectedVariant: null, variationId: null, trackInventory: false, productType: 'bundle', isRoutine: false, routineComponents: components });
            subtotal += price * qty;
        }
        else {
            const line = await productLine(conn, input, qty, features);
            const attributes = parse(line.variant?.attributes) || {};
            canonicalItems.push({ productId: line.product.id, productName: line.product.name, quantity: qty, price: line.price, image: null, selectedVariant: line.variant ? Object.entries(attributes).map(([key, value]) => key + ': ' + value).join(', ') : null, variationId: line.variant?.id || null, trackInventory: false, productType: 'simple', isRoutine: input.isRoutine === true, routineComponents: [{ ...line.component, source: 'product', quantity: line.component.quantity / qty }] });
            subtotal += line.price * qty;
        }
    }
    subtotal = roundMoney(subtotal);
    const [settingsRows] = await conn.execute('SELECT standardShippingFee,freeShippingThreshold FROM settings LIMIT 1');
    const settings = settingsRows[0];
    if (!settings)
        throw new ClientError('Shipping settings are not configured.', 503);
    const routine = features.routineBuilder ? calculateRoutineDiscount(canonicalItems.filter(line => line.isRoutine && !String(line.productId).startsWith('routine-')).map(line => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.price })), await getRoutineSettings(conn)).savings : 0;
    const eligibleForCoupon = canonicalItems
        .filter(line => !line.isRoutine && line.productType !== 'bundle')
        .reduce((sum, line) => sum + line.price * line.quantity, 0);
    let couponDiscount = 0;
    if (couponCode) {
        if (!features.coupons)
            throw new ClientError('Coupons are not available.', 404);
        const [rows] = await conn.execute('SELECT id,code,isActive,discountType,discountValue,minPurchase,expiryDate,usageLimit,usageCount FROM coupons WHERE code=? AND isActive=1 AND (expiryDate IS NULL OR expiryDate>=CURRENT_DATE()) FOR UPDATE', [couponCode]);
        const coupon = rows[0];
        if (!coupon)
            throw new ClientError('Your coupon is no longer valid.');
        if (eligibleForCoupon <= 0)
            throw new ClientError('Coupon discounts cannot be stacked with bundle or routine savings.');
        couponDiscount = couponSavings(coupon, eligibleForCoupon);
        const [used] = await conn.execute('UPDATE coupons SET usageCount=usageCount+1 WHERE id=? AND isActive=1 AND (expiryDate IS NULL OR expiryDate>=CURRENT_DATE()) AND (usageLimit IS NULL OR usageCount<usageLimit)', [coupon.id]);
        if (!used.affectedRows)
            throw new ClientError('Coupon usage limit reached.');
    }
    const discount = roundMoney(Math.min(subtotal, routine + couponDiscount));
    const after = roundMoney(subtotal - discount);
    const shippingFee = after >= amount(settings.freeShippingThreshold) ? 0 : amount(settings.standardShippingFee);
    return { items: canonicalItems, subtotal, discount, couponDiscount, shippingFee, total: roundMoney(after + shippingFee), features };
}
