import { checkoutPayment } from '../lib/checkoutPayment.js';
import { calculateCheckout } from '../mysql-lib/checkout.js';
import { ClientError, publicError } from '../lib/httpError.js';
import { requireFeature } from '../middleware/features.js';
import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, authenticateIfPresent, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { sendMetaPurchase } from '../lib/metaConversionsApi.js';
import { sendTikTokPurchase } from '../lib/tiktokEventsApi.js';
import { getEmailFailureCode, sendOrderConfirmationEmail, sendOrderDeliveredEmail, sendOrderStatusEmail, sendAdminNewOrderEmail, getAdminNotificationRecipients } from '../utils/mailer.js';
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
    if ((orderRows as any[]).length === 0)
        return null;
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
    return 'LEV-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
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
        isRoutine: String(item.productId).startsWith('routine-'),
        productType: String(item.productId).startsWith('routine-') || readRoutineComponents(item.routineComponents)[0]?.source === 'bundle' ? 'bundle' : 'simple',
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
                conditions.push("(orderId LIKE ? OR guestEmail LIKE ? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(shippingAddress),shippingAddress,'{}'), '$.fullName')),JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(shippingAddress),shippingAddress,'{}'), '$.name')),'') LIKE ?)");
                const searchStr = `%${search.trim().slice(0,120)}%`;
                params.push(searchStr, searchStr, searchStr);
            }
        }
        else {
            conditions.push('user_id = ?');
            params.push(req.user?.userId);
        }
        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            sql += whereClause;
            countSql += whereClause;
        }
        sql += ' ORDER BY createdAt DESC';
        const isPaginated = isAdmin;
        let pageNum = 1;
        let limitNum = 50;
        let totalCount = 0;
        if (isPaginated) {
            pageNum = Math.min(1000000,Math.max(1, parseInt(page as string) || 1));
            limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 25));
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
                if (!itemsMap.has(item.order_id))
                    itemsMap.set(item.order_id, []);
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
        }
        else {
            res.json(ordersArr);
        }
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// GET single order by orderId
router.get('/:orderId', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const order = await getFullOrder(pool, req.params.orderId);
        if (!order)
            return res.status(404).json({ error: 'Order not found' });
        const isAdmin = ['admin', 'super_admin'].includes(req.user?.role || '');
        const isOwner = order.guestEmail && order.guestEmail.toLowerCase() === req.user?.email?.toLowerCase();
        const isUserOwner = order.user_id === req.user?.userId;
        if (!isAdmin && !isOwner && !isUserOwner) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json(mapOrderForFrontend(order));
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// POST Place New Order — with atomic stock deduction using MySQL TRANSACTION + SELECT FOR UPDATE
router.post('/', authenticateIfPresent, async (req: AuthRequest, res: Response) => {
    let conn: any;
    let committed = false;
    let requestId = '';
    try {
        checkoutPayment(req.body.paymentMethod);
        const { customerName, phone, items, shippingAddress } = req.body;
        const email = req.user?.email || req.body.email;
        requestId = String(req.body.checkoutRequestId || '');
        if (!Array.isArray(items) || !items.length || items.length > 100)
            throw new ClientError('Order must contain between 1 and 100 items.');
        if (typeof customerName !== 'string' || !customerName.trim() || customerName.length > 120 || typeof phone !== 'string' || phone.length > 40 || !phone.trim() || !shippingAddress || typeof shippingAddress !== 'object' || Array.isArray(shippingAddress) || typeof shippingAddress.city !== 'string' || !shippingAddress.city.trim())
            throw new ClientError('Customer name, phone and delivery city are required.');
        if (!/^[a-zA-Z0-9_-]{16,120}$/.test(requestId))
            throw new ClientError('A valid checkout request ID is required.');
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [indexes]: any = await conn.execute('SHOW INDEX FROM orders');
        const grouped = new Map<string, any[]>();
        for (const index of indexes)
            grouped.set(index.Key_name, [...(grouped.get(index.Key_name) || []), index]);
        if (![...grouped.values()].some(rows => rows.length === 1 && rows[0].Column_name === 'checkoutRequestId' && rows[0].Non_unique === 0))
            throw new ClientError('Checkout storage migration is required.', 503);
        const [existing] = await conn.execute('SELECT orderId,guestPhone,user_id FROM orders WHERE checkoutRequestId=?', [requestId]);
        if (existing.length) {
            if (existing[0].guestPhone !== phone || (existing[0].user_id || null) !== (req.user?.userId || null))
                throw new ClientError('Checkout request ID is already in use.', 409);
            const result = mapOrderForFrontend(await getFullOrder(conn, existing[0].orderId));
            await conn.commit();
            return res.json(result);
        }
        const rawCoupon = req.body.coupon ?? req.body.appliedCoupon?.code ?? '';
        if (typeof rawCoupon !== 'string' || rawCoupon.length > 40)
            throw new ClientError('Invalid coupon code.');
        const coupon = rawCoupon.trim().toUpperCase();
        const totals = await calculateCheckout(conn, items, coupon);
        const orderId = generateOrderId(), internalId = crypto.randomBytes(12).toString('hex'), now = new Date();
        await conn.execute('INSERT INTO orders (id,orderId,user_id,guestEmail,guestPhone,total,subtotal,shippingFee,discountAmount,status,paymentMethod,shippingAddress,appliedCoupon,checkoutRequestId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [internalId, orderId, req.user?.userId || null, email ? String(email).trim().toLowerCase() : null, phone, totals.total, totals.subtotal, totals.shippingFee, totals.discount, 'Pending', 'COD', JSON.stringify({ ...shippingAddress, fullName: customerName, phone }), coupon ? JSON.stringify({ code: coupon }) : null, requestId, now, now]);
        for (const item of totals.items)
            await conn.execute('INSERT INTO order_items (id,order_id,productId,productName,quantity,price,image,selectedVariant,variationId,routineComponents) VALUES (?,?,?,?,?,?,?,?,?,?)', [crypto.randomBytes(12).toString('hex'), internalId, item.productId, item.productName, item.quantity, item.price, item.image, item.selectedVariant, item.variationId, item.routineComponents ? JSON.stringify(item.routineComponents) : null]);
        await conn.execute('INSERT INTO order_status_history (id,order_id,status,note,timestamp) VALUES (?,?,?,?,?)', [crypto.randomBytes(12).toString('hex'), internalId, 'Pending', 'Order placed', now]);
        await conn.commit();
        committed = true;
        const dbOrder = await getFullOrder(pool, orderId);
        const newOrder = dbOrder ? mapOrderForFrontend(dbOrder) : null;
        // Fire-and-forget CAPI events + emails (same pattern as MongoDB version)
        const metaEventId = `purchase_${orderId}`;
        void (async () => {
            try {
                await sendOrderConfirmationEmail(newOrder, {});
                await pool.execute('UPDATE orders SET confirmationEmailSentAt = NOW(), confirmationEmailAccepted = 1 WHERE orderId = ?', [orderId]);
            }
            catch (e) {
                logEmailFailure('Order confirmation', orderId, e);
                await pool.execute('UPDATE orders SET confirmationEmailAccepted = 0 WHERE orderId = ?', [orderId]);
            }
            try {
                const recipients = getAdminNotificationRecipients();
                if (recipients.length > 0)
                    await sendAdminNewOrderEmail(newOrder, recipients);
            }
            catch (e) {
                logEmailFailure('Admin new order', orderId, e);
            }
            try {
                const capiOrder = { ...newOrder, email: newOrder.guestEmail, phone: newOrder.guestPhone, customerName: newOrder.shippingAddress?.name };
                if (totals.features.tracking)
                    await sendMetaPurchase({ order: capiOrder, req, eventId: metaEventId });
                if (totals.features.tracking)
                    console.log(`[Meta CAPI] Tracked order ${orderId}`);
            }
            catch (e) {
                console.error(`[Meta CAPI] Could not track order ${orderId}:`, e);
            }
            try {
                const capiOrder = { ...newOrder, email: newOrder.guestEmail, phone: newOrder.guestPhone, customerName: newOrder.shippingAddress?.name };
                if (totals.features.tracking)
                    await sendTikTokPurchase({ order: capiOrder, req, eventId: metaEventId });
                if (totals.features.tracking)
                    console.log(`[TikTok Events API] Tracked order ${orderId}`);
            }
            catch (e) {
                console.error(`[TikTok Events API] Could not track order ${orderId}:`, e);
            }
        })().catch(()=>console.error('Order notifications could not finish.'));
        res.status(201).json(newOrder);
    }
    catch (error: any) {
        if (conn && !committed)
            await conn.rollback();
        if (error.code === 'ER_DUP_ENTRY' && requestId) {
            try {
                const [rows]: any = await pool.execute('SELECT orderId,guestPhone,user_id FROM orders WHERE checkoutRequestId=?', [requestId]);
                if (rows[0] && rows[0].guestPhone === req.body.phone && (rows[0].user_id || null) === (req.user?.userId || null))
                    return res.json(mapOrderForFrontend(await getFullOrder(pool, rows[0].orderId)));
            }
            catch { }
            return res.status(409).json({ error: 'Checkout request ID is already in use.' });
        }
        res.status(error instanceof ClientError ? error.status : 503).json({ error: publicError(error, 'Unable to place the order. Please retry using the same request ID.') });
    }
    finally {
        conn?.release();
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
        if (previousStatus === 'Cancelled' && status !== 'Cancelled') {
            await conn.rollback();
            return res.status(409).json({ error: 'A cancelled order cannot be reopened. Create a new order.' });
        }
        // If cancelling — restore stock
        if (status === 'Cancelled' && previousStatus !== 'Cancelled') {
            const [items] = await conn.execute('SELECT productId,quantity,variationId,routineComponents FROM order_items WHERE order_id = ?', [order.id]);
            for (const item of items as any[]) {
                if (await restoreRoutineStock(conn, item))
                    continue;
                if (item.variationId) {
                    await conn.execute('UPDATE product_variants SET stockQuantity=stockQuantity+? WHERE id=? AND manageStock=1', [item.quantity, item.variationId]);
                    continue;
                }
                const [bundleChildren]: any = await conn.execute('SELECT product_id,quantity FROM bundle_products WHERE bundle_id=?', [item.productId]);
                if (bundleChildren.length) {
                    for (const child of bundleChildren)
                        await conn.execute('UPDATE products SET stockQuantity=stockQuantity+?,updatedAt=? WHERE id=? AND trackInventory=1', [Number(child.quantity) * item.quantity, now, child.product_id]);
                    continue;
                }
                await conn.execute(`UPDATE products SET stockQuantity = stockQuantity + ?, updatedAt = ? WHERE id = ? AND trackInventory = 1`, [item.quantity, now, item.productId]);
            }
        }
        await conn.execute('UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?', [status, now, order.id]);
        // Log to order_status_history
        await conn.execute(`INSERT INTO order_status_history (id, order_id, status, note, timestamp) VALUES (?, ?, ?, ?, ?)`, [crypto.randomBytes(12).toString('hex'), order.id, status, note || `Status changed from ${previousStatus} to ${status}`, now]);
        await conn.commit();
        let updatedOrder = await getFullOrder(pool, req.params.orderId);
        if (updatedOrder)
            updatedOrder = mapOrderForFrontend(updatedOrder);
        // Fire status email (non-blocking)
        if (previousStatus !== status && updatedOrder?.guestEmail) {
            void sendOrderStatusEmail(updatedOrder).catch((e: any) => logEmailFailure('Order status', req.params.orderId, e));
        }
        res.json({ order: updatedOrder, notification: { statusChanged: previousStatus !== status } });
    }
    catch (err: any) {
        await conn.rollback();
        res.status(400).json({ error: 'Unable to complete this request.' });
    }
    finally {
        conn.release();
    }
});
// PUT Update Tracking Number (Admin)
router.put('/:orderId/tracking', requireFeature('tracking'), authenticateToken, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { trackingNumber } = req.body;
        const [result] = await pool.execute('UPDATE orders SET trackingNumber = ?, updatedAt = ? WHERE orderId = ?', [trackingNumber, new Date(), req.params.orderId]);
        if ((result as any).affectedRows === 0)
            return res.status(404).json({ error: 'Order not found' });
        const updated = await getFullOrder(pool, req.params.orderId);
        res.json(updated ? mapOrderForFrontend(updated) : null);
    }
    catch (err: any) {
        res.status(400).json({ error: 'Unable to complete this request.' });
    }
});
// DELETE Order (Admin)
router.delete('/:orderId', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
    try {
        const [orderRows] = await pool.execute('SELECT id FROM orders WHERE id = ? OR orderId = ?', [req.params.orderId, req.params.orderId]);
        if ((orderRows as any[]).length === 0)
            return res.status(404).json({ error: 'Order not found' });
        const orderIdInternal = (orderRows as any[])[0].id;
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            await conn.execute('DELETE FROM order_items WHERE order_id = ?', [orderIdInternal]);
            await conn.execute('DELETE FROM order_status_history WHERE order_id = ?', [orderIdInternal]);
            await conn.execute('DELETE FROM orders WHERE id = ?', [orderIdInternal]);
            await conn.commit();
            res.json({ message: 'Order deleted successfully' });
        }
        catch (err) {
            await conn.rollback();
            throw err;
        }
        finally {
            conn.release();
        }
    }
    catch (err: any) {
        res.status(400).json({ error: 'Unable to complete this request.' });
    }
});
export default router;
