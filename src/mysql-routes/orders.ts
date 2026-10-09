import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { sendMetaPurchase } from '../lib/metaConversionsApi.js';
import { sendTikTokPurchase } from '../lib/tiktokEventsApi.js';
import {
  getEmailFailureCode,
  sendOrderConfirmationEmail,
  sendOrderDeliveredEmail,
  sendOrderStatusEmail,
  sendAdminNewOrderEmail,
  getAdminNotificationRecipients
} from '../utils/mailer.js';
import crypto from 'crypto';
import { calculateRoutineDiscount, roundMoney } from '../lib/routineDiscount.js';
import { getRoutineSettings } from '../mysql-lib/routineSettings.js';
import { resolveCartLine } from '../lib/pricingOffers.js';

import { resolveRoutineOrder, readRoutineComponents, restoreRoutineStock } from '../mysql-lib/routineOrders.js';

const router = Router();

const logEmailFailure = (kind: string, orderId: string, error: unknown) => {
  console.error(`${kind} email failed for order ${orderId}:`, error);
};

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const ORDER_COLS = 'id, orderId, user_id, guestEmail, guestPhone, total, subtotal, shippingFee, status, paymentMethod, shippingAddress, paymentDetails, createdAt, updatedAt, discountAmount, appliedCoupon, checkoutRequestId, trackingNumber, confirmationEmailSentAt, confirmationEmailAccepted';
const ORDER_ITEM_COLS = 'id, order_id, productId, productName, quantity, price, image, selectedVariant, variationId, routineComponents';
const ORDER_HISTORY_COLS = 'id, order_id, status, note, timestamp';

// Helper: Assemble a full order object (order + items + status history)
async function getFullOrder(conn: any, orderId: string) {
  const [orderRows] = await conn.execute(`SELECT ${ORDER_COLS} FROM orders WHERE id = ? OR orderId = ?`, [orderId, orderId]);
  if ((orderRows as any[]).length === 0) return null;

  const order = (orderRows as any[])[0];
  const [items] = await conn.execute(`SELECT ${ORDER_ITEM_COLS} FROM order_items WHERE order_id = ?`, [order.id]);
  const [history] = await conn.execute(`SELECT ${ORDER_HISTORY_COLS} FROM order_status_history WHERE order_id = ? ORDER BY timestamp ASC`, [order.id]);

  order.items = items;
  order.statusHistory = history;
  order.shippingAddress = typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : order.shippingAddress;
  return order;
}

// Generate a readable order ID (same pattern as original Mongo version)
function generateOrderId() {
  return 'ALV-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}


// Map MySQL order structure to match the old MongoDB schema expected by the frontend
export function mapOrderForFrontend(o: any) {
  const shipAddr = typeof o.shippingAddress === 'string' ? JSON.parse(o.shippingAddress) : (o.shippingAddress || {});
  
  let dateStr = o.date;
  if (!dateStr && o.createdAt) {
    const d = new Date(o.createdAt);
    if (!isNaN(d.getTime())) {
      dateStr = d.toISOString().split('T')[0];
    }
  }

  const mappedItems = (o.items || []).map((item: any) => ({
    ...item,
    routineComponents: readRoutineComponents(item.routineComponents),
    isRoutine: readRoutineComponents(item.routineComponents).length > 0,
    ...(readRoutineComponents(item.routineComponents).length ? { productType: 'bundle' } : {}),
    name: item.productName || item.name,
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 1)
  }));

  return {
    ...o,
    shippingAddress: shipAddr,
    customerName: o.customerName || shipAddr.fullName || shipAddr.name || o.guestEmail || 'Customer',
    email: o.guestEmail || o.email,
    phone: o.guestPhone || o.phone || shipAddr.phone,
    date: dateStr,
    total: Number(o.total || 0),
    subtotal: Number(o.subtotal || 0),
    shippingFee: Number(o.shippingFee || 0),
    deliveryCharge: Number(o.shippingFee || 0),
    discountAmount: Number(o.discountAmount || 0),
    items: mappedItems
  };
}

// GET all orders (admin sees all, customers see only their own)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { email, page, limit, search, status } = req.query;
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role || '');
    
    let sql = `SELECT ${ORDER_COLS} FROM orders`;
    let countSql = 'SELECT COUNT(*) as count FROM orders';
    const params: any[] = [];
    const conditions: string[] = [];

    if (isAdmin) {
      if (typeof email === 'string' && email.trim()) {
        conditions.push('guestEmail = ?');
        params.push(email.trim().toLowerCase());
      }
      if (typeof status === 'string' && status !== 'all' && status.trim()) {
        conditions.push('status = ?');
        params.push(status.trim());
      }
      if (typeof search === 'string' && search.trim()) {
        conditions.push('(orderId LIKE ? OR guestEmail LIKE ? OR customerName LIKE ?)');
        const searchStr = `%${search.trim()}%`;
        params.push(searchStr, searchStr, searchStr);
      }
    } else {
      conditions.push('user_id = ?');
      params.push(req.user?.userId);
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      sql += whereClause;
      countSql += whereClause;
    }

    sql += ' ORDER BY createdAt DESC';

    const isPaginated = isAdmin && (page || limit || search || status);
    
    let pageNum = 1;
    let limitNum = 50;
    let totalCount = 0;
    
    if (isPaginated) {
      pageNum = Math.max(1, parseInt(page as string) || 1);
      limitNum = Math.max(1, parseInt(limit as string) || 25);
      const offset = (pageNum - 1) * limitNum;
      
      const [countRows] = await pool.execute(countSql, params);
      totalCount = (countRows as any)[0].count;
      
      sql += ` LIMIT ${limitNum} OFFSET ${offset}`;
    }

    const [orders] = await pool.execute(sql, params);

    // Attach items to each order
    let ordersArr = orders as any[];
    if (ordersArr.length > 0) {
      const orderIds = ordersArr.map(o => o.id);
      const placeholders = orderIds.map(() => '?').join(',');
      const [allItems] = await pool.execute(`SELECT ${ORDER_ITEM_COLS} FROM order_items WHERE order_id IN (${placeholders})`, orderIds);
      const itemsMap = new Map<string, any[]>();
      (allItems as any[]).forEach(item => {
        if (!itemsMap.has(item.order_id)) itemsMap.set(item.order_id, []);
        itemsMap.get(item.order_id)!.push(item);
      });
      ordersArr = ordersArr.map(o => {
        o.items = itemsMap.get(o.id) || [];
        return mapOrderForFrontend(o);
      });
    }

    if (isPaginated) {
      res.json({
        orders: ordersArr,
        totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / limitNum)
      });
    } else {
      res.json(ordersArr);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single order by orderId
router.get('/:orderId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const order = await getFullOrder(pool, req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role || '');
    const isOwner = order.guestEmail && order.guestEmail.toLowerCase() === req.user?.email?.toLowerCase();
    const isUserOwner = order.user_id === req.user?.userId;

    if (!isAdmin && !isOwner && !isUserOwner) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(mapOrderForFrontend(order));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Place New Order — with atomic stock deduction using MySQL TRANSACTION + SELECT FOR UPDATE
router.post('/', async (req: Request, res: Response) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const { customerName, email, phone, items, discountAmount = 0, shippingAddress, appliedCoupon, checkoutRequestId, shippingFee: clientShippingFee, deliveryCharge: clientDeliveryCharge, shipping: clientShipping } = req.body;
    const resolvedClientShipping = clientShippingFee ?? clientDeliveryCharge ?? clientShipping;

    if (!Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Order must contain at least one product' });
    }
    if (!customerName || !phone) {
      await conn.rollback();
      return res.status(400).json({ error: 'Customer name and phone are required' });
    }

    // Idempotency: check if this request was already processed
    if (checkoutRequestId && /^[a-zA-Z0-9_-]{16,120}$/.test(checkoutRequestId)) {
      const [existing] = await conn.execute('SELECT orderId FROM orders WHERE checkoutRequestId = ?', [checkoutRequestId]);
      if ((existing as any[]).length > 0) {
        let existingOrder = await getFullOrder(conn, (existing as any[])[0].orderId);
        if (existingOrder) existingOrder = mapOrderForFrontend(existingOrder);
        await conn.commit();
        return res.status(200).json(existingOrder);
      }
    }

    // Validate products and compute totals
    const canonicalItems: any[] = [];

      
    let computedSubtotal = 0;

    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid item in order' });
      }

      if (item.routineComponents !== undefined) {
        const routineItem = await resolveRoutineOrder(conn, item);
        canonicalItems.push(routineItem);
        computedSubtotal += routineItem.price * routineItem.quantity;
        continue;
      }
      const isBundle = item.productType === 'bundle';
      if (isBundle && item.isRoutine === true) {
        throw new Error('Choose individual products for a custom routine.');
      }
      const qty = Number(item.quantity);
      let unitPrice = 0;
      let tracks = false;
      let productName = item.name || '';

      if (isBundle) {
        // Validate against Bundles table
        const [bundleRows] = await conn.execute(
          'SELECT id, name, bundlePrice, customPrice, discountValue, discountPercent, isActive FROM bundles WHERE id = ? FOR UPDATE',
          [item.productId]
        );
        if ((bundleRows as any[]).length === 0) {
          await conn.rollback();
          return res.status(400).json({ error: `Bundle not found: ${item.productId}` });
        }
        const bundle = (bundleRows as any[])[0];
        if (!bundle.isActive) {
          await conn.rollback();
          return res.status(400).json({ error: `Bundle is unavailable: ${bundle.name}` });
        }
        productName = bundle.name;
        unitPrice = Number(item.price || bundle.customPrice || bundle.bundlePrice || 0);
        tracks = true; // Bundles explicitly deduct stock from their children
      } else {
        // Validate against Products table
        const [productRows] = await conn.execute(
          'SELECT id, name, price, stockQuantity, trackInventory, inStock, status, isVisible, productType, pricingOffers FROM products WHERE id = ? FOR UPDATE',
          [item.productId]
        );
        if ((productRows as any[]).length === 0) {
          await conn.rollback();
          return res.status(400).json({ error: `Product not found: ${item.productId}` });
        }
        const product = (productRows as any[])[0];
        if (product.status === 'draft' || product.isVisible === 0 || product.isVisible === false) {
          await conn.rollback();
          return res.status(400).json({ error: `Product is unavailable: ${product.name}` });
        }

        const stock = Number(product.stockQuantity);
        tracks = product.trackInventory === 1 || product.trackInventory === true || product.trackInventory === '1';

        if (tracks) {
          if (product.inStock === 0 || product.inStock === false || stock < qty) {
            await conn.rollback();
            return res.status(400).json({ error: `${product.name} does not have enough stock (available: ${stock}, requested: ${qty})` });
          }
        }
        productName = product.name;
        unitPrice = Number(item.price || product.price);
        if (item.isRoutine === true) {
          let basePrice = Number(product.price);
          if (product.productType === 'variable') {
            const [variationRows] = await conn.execute('SELECT id, regularPrice, salePrice, enabled, manageStock, stockQuantity, stockStatus FROM product_variants WHERE id = ? AND product_id = ? FOR UPDATE', [item.variationId || '', product.id]);
            const variation = (variationRows as any[])[0];
            if (!variation || !variation.enabled || variation.stockStatus === 'out_of_stock' || (variation.manageStock && Number(variation.stockQuantity) < qty)) {
              throw new Error(`Choose an available option for ${product.name}.`);
            }
            basePrice = Number(variation.salePrice ?? variation.regularPrice);
          } else if (!product.inStock) {
            throw new Error(`${product.name} is out of stock.`);
          }
          const offers = typeof product.pricingOffers === 'string' ? JSON.parse(product.pricingOffers) : product.pricingOffers;
          unitPrice = resolveCartLine(offers, basePrice, qty).unitPrice;
        }
      }

      computedSubtotal += unitPrice * qty;

      canonicalItems.push({
        productId: item.productId,
        isRoutine: item.isRoutine === true,
        productName: productName,
        quantity: qty,
        price: unitPrice,
        image: item.image || null,
        selectedVariant: item.selectedVariant || null,
        variationId: item.variationId || null,
        trackInventory: tracks,
        productType: isBundle ? 'bundle' : 'simple'
      });
    }

    // Fetch shipping settings
    const [settingsRows] = await conn.execute('SELECT standardShippingFee, freeShippingThreshold FROM settings LIMIT 1');
    const settings = (settingsRows as any[])[0] || { standardShippingFee: 200, freeShippingThreshold: 3000 };
    const routine = calculateRoutineDiscount(canonicalItems.filter(item => item.isRoutine && !item.routineComponents).map(item => ({
      productId: item.productId, quantity: item.quantity, unitPrice: item.price,
    })), await getRoutineSettings(conn));
    let couponDiscount = 0;
    if (appliedCoupon) {
      const [couponRows] = await conn.execute('SELECT discountType, discountValue, minPurchase, usageLimit, usageCount, expiryDate FROM coupons WHERE code = ? AND isActive = 1', [String(appliedCoupon.code || '').trim().toUpperCase()]);
      const coupon = (couponRows as any[])[0];
      if (!coupon || computedSubtotal < Number(coupon.minPurchase || 0) || (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) || (coupon.expiryDate && new Date(coupon.expiryDate).getTime() < Date.now())) {
        throw new Error('Your coupon is no longer valid. Please remove it and try again.');
      }
      couponDiscount = coupon.discountType === 'percentage' ? computedSubtotal * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
    }
    const discount = roundMoney(Math.min(computedSubtotal, routine.savings + couponDiscount));
    if (!Number.isFinite(Number(discountAmount)) || Math.abs(Number(discountAmount) - discount) > 0.02) {
      throw new Error('Routine savings or prices have changed. Refresh your cart and try again.');
    }

    const afterDiscount = Math.max(0, computedSubtotal - discount);
    const shippingFee = resolvedClientShipping !== undefined ? Number(resolvedClientShipping) : (afterDiscount >= Number(settings.freeShippingThreshold) ? 0 : Number(settings.standardShippingFee));
    const total = afterDiscount + shippingFee;

    // --- FALLBACK IDEMPOTENCY ---
    // If a user retries after a timeout, they might have generated a new checkoutRequestId if storage is blocked.
    // Prevent duplicate orders within a 5-minute window for the same phone and total amount.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [recentOrders] = await conn.execute(
      'SELECT orderId FROM orders WHERE guestPhone = ? AND total = ? AND createdAt >= ? ORDER BY createdAt DESC LIMIT 1',
      [phone, total, fiveMinutesAgo]
    );
    if ((recentOrders as any[]).length > 0) {
      let existingOrder = await getFullOrder(conn, (recentOrders as any[])[0].orderId);
      if (existingOrder) existingOrder = mapOrderForFrontend(existingOrder);
      await conn.commit();
      return res.status(200).json(existingOrder);
    }

    // Create the order
    const orderId = generateOrderId();
    const internalId = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    await conn.execute(
      `INSERT INTO orders (id, orderId, guestEmail, guestPhone, total, subtotal, shippingFee, discountAmount, status, paymentMethod, shippingAddress, appliedCoupon, checkoutRequestId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        internalId, orderId, email ? email.trim().toLowerCase() : null, phone,
        total, computedSubtotal, shippingFee, discount,
        'Pending', 'COD',
        JSON.stringify(shippingAddress || {}),
        appliedCoupon ? JSON.stringify(appliedCoupon) : null,
        checkoutRequestId || null,
        now, now
      ]
    );

    // Insert order_items and atomically deduct stock in the same transaction
    for (const item of canonicalItems) {
      const itemId = crypto.randomBytes(12).toString('hex');
      await conn.execute(
        `INSERT INTO order_items (id, order_id, productId, productName, quantity, price, image, selectedVariant, variationId, routineComponents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [itemId, internalId, item.productId, item.productName, item.quantity, item.price, item.image, item.selectedVariant, item.variationId, item.routineComponents ? JSON.stringify(item.routineComponents) : null]
      );

      // Atomic stock deduction
      if (item.trackInventory) {
        if (item.productType === 'bundle') {
          // Deduct from underlying bundle components
          const [bundleProducts] = await conn.execute(
            'SELECT product_id, quantity FROM bundle_products WHERE bundle_id = ?',
            [item.productId]
          );
          for (const bp of bundleProducts as any[]) {
            const deductQty = bp.quantity * item.quantity;
            const [stockResult] = await conn.execute(
              `UPDATE products SET stockQuantity = stockQuantity - ?, updatedAt = ? WHERE id = ? AND stockQuantity >= ? AND trackInventory = 1`,
              [deductQty, now, bp.product_id, deductQty]
            );
            if ((stockResult as any).affectedRows === 0) {
              // Confirm if it failed due to OOS or just non-tracking product
              const [check] = await conn.execute('SELECT trackInventory FROM products WHERE id = ?', [bp.product_id]);
              if ((check as any[]).length > 0 && ((check as any[])[0].trackInventory === 1 || (check as any[])[0].trackInventory === true)) {
                await conn.rollback();
                return res.status(400).json({ error: `A component of ${item.productName} ran out of stock. Please refresh and try again.` });
              }
            }
          }
        } else {
          // Normal product deduction
          const [stockResult] = await conn.execute(
            `UPDATE products SET stockQuantity = stockQuantity - ?, updatedAt = ? WHERE id = ? AND stockQuantity >= ? AND trackInventory = 1`,
            [item.quantity, now, item.productId, item.quantity]
          );
          if ((stockResult as any).affectedRows === 0) {
            const [check] = await conn.execute('SELECT trackInventory FROM products WHERE id = ?', [item.productId]);
            if ((check as any[]).length > 0 && ((check as any[])[0].trackInventory === 1 || (check as any[])[0].trackInventory === true)) {
              await conn.rollback();
              return res.status(400).json({ error: `${item.productName} ran out of stock. Please refresh and try again.` });
            }
          }
        }
      }
    }

    // Add initial status history entry
    await conn.execute(
      `INSERT INTO order_status_history (id, order_id, status, note, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomBytes(12).toString('hex'), internalId, 'Pending', 'Order placed', now]
    );

    await conn.commit();

    // Fetch the complete order after commit
    const dbOrder = await getFullOrder(pool, orderId);
    const newOrder = dbOrder ? mapOrderForFrontend(dbOrder) : null;

    // Fire-and-forget CAPI events + emails (same pattern as MongoDB version)
    const metaEventId = `purchase_${orderId}`;

    void (async () => {
      try {
        await sendOrderConfirmationEmail(newOrder, {});
        await pool.execute('UPDATE orders SET confirmationEmailSentAt = NOW(), confirmationEmailAccepted = 1 WHERE orderId = ?', [orderId]);
      } catch (e) {
        logEmailFailure('Order confirmation', orderId, e);
        await pool.execute('UPDATE orders SET confirmationEmailAccepted = 0 WHERE orderId = ?', [orderId]);
      }
      try {
        const recipients = getAdminNotificationRecipients();
        if (recipients.length > 0) await sendAdminNewOrderEmail(newOrder, recipients);
      } catch (e) { logEmailFailure('Admin new order', orderId, e); }
      try {
        const capiOrder = { ...newOrder, email: newOrder.guestEmail, phone: newOrder.guestPhone, customerName: newOrder.shippingAddress?.name };
        await sendMetaPurchase({ order: capiOrder, req, eventId: metaEventId });
        console.log(`[Meta CAPI] Tracked order ${orderId}`);
      } catch (e) { console.error(`[Meta CAPI] Could not track order ${orderId}:`, e); }
      try {
        const capiOrder = { ...newOrder, email: newOrder.guestEmail, phone: newOrder.guestPhone, customerName: newOrder.shippingAddress?.name };
        await sendTikTokPurchase({ order: capiOrder, req, eventId: metaEventId });
        console.log(`[TikTok Events API] Tracked order ${orderId}`);
      } catch (e) { console.error(`[TikTok Events API] Could not track order ${orderId}:`, e); }
    })();

    res.status(201).json(newOrder);
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT Update Order Status (Admin)
router.put('/:orderId/status', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const { status, note } = req.body;
    const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid order status' });
    }

    const [orderRows] = await conn.execute('SELECT id, status, orderId FROM orders WHERE id = ? OR orderId = ? FOR UPDATE', [req.params.orderId, req.params.orderId]);
    if ((orderRows as any[]).length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = (orderRows as any[])[0];
    const previousStatus = order.status;
    const now = new Date();

    // If cancelling — restore stock
    if (status === 'Cancelled' && previousStatus !== 'Cancelled') {
      const [items] = await conn.execute('SELECT productId, quantity, routineComponents FROM order_items WHERE order_id = ?', [order.id]);
      for (const item of items as any[]) {
        if (await restoreRoutineStock(conn, item)) continue;
        await conn.execute(
          `UPDATE products SET stockQuantity = stockQuantity + ?, updatedAt = ? WHERE id = ? AND trackInventory = 1`,
          [item.quantity, now, item.productId]
        );
      }
    }

    await conn.execute(
      'UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?',
      [status, now, order.id]
    );

    // Log to order_status_history
    await conn.execute(
      `INSERT INTO order_status_history (id, order_id, status, note, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomBytes(12).toString('hex'), order.id, status, note || `Status changed from ${previousStatus} to ${status}`, now]
    );

    await conn.commit();

    let updatedOrder = await getFullOrder(pool, req.params.orderId);
    if (updatedOrder) updatedOrder = mapOrderForFrontend(updatedOrder);

    // Fire status email (non-blocking)
    if (previousStatus !== status && updatedOrder?.guestEmail) {
      void sendOrderStatusEmail(updatedOrder).catch((e: any) => logEmailFailure('Order status', req.params.orderId, e));
    }

    res.json({ order: updatedOrder, notification: { statusChanged: previousStatus !== status } });
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT Update Tracking Number (Admin)
router.put('/:orderId/tracking', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.body;
    const [result] = await pool.execute(
      'UPDATE orders SET trackingNumber = ?, updatedAt = ? WHERE orderId = ?',
      [trackingNumber, new Date(), req.params.orderId]
    );
    if ((result as any).affectedRows === 0) return res.status(404).json({ error: 'Order not found' });
    const updated = await getFullOrder(pool, req.params.orderId);
    res.json(updated ? mapOrderForFrontend(updated) : null);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE Order (Admin)
router.delete('/:orderId', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [orderRows] = await pool.execute('SELECT id FROM orders WHERE id = ? OR orderId = ?', [req.params.orderId, req.params.orderId]);
    if ((orderRows as any[]).length === 0) return res.status(404).json({ error: 'Order not found' });
    const orderIdInternal = (orderRows as any[])[0].id;

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      await conn.execute('DELETE FROM order_items WHERE order_id = ?', [orderIdInternal]);
      await conn.execute('DELETE FROM order_status_history WHERE order_id = ?', [orderIdInternal]);
      await conn.execute('DELETE FROM orders WHERE id = ?', [orderIdInternal]);
      await conn.commit();
      res.json({ message: 'Order deleted successfully' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
