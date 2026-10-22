import { sessionCookieName, sessionCookieOptions } from '../config/sessionCookie.js';
import jwt from 'jsonwebtoken';
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
import bcrypt from 'bcryptjs';
import { calculateRoutineDiscount, roundMoney } from '../lib/routineDiscount.js';
import { getRoutineSettings } from '../mysql-lib/routineSettings.js';
import { resolveCartLine } from '../lib/pricingOffers.js';
import { resolveRoutineOrder, readRoutineComponents, restoreRoutineStock } from '../mysql-lib/routineOrders.js';
const router = Router();
const logEmailFailure = (kind: string, orderId: string, error: unknown) => {
    console.error(`${kind} email failed for order ${orderId}: ${getEmailFailureCode(error)}`);
};

/**
 * Run email dispatch after the transaction commits but before a serverless
 * invocation returns. A detached promise can be terminated by the host as
 * soon as the HTTP response is sent, causing intermittent missing new-order
 * notifications. Delivery errors intentionally never change the saved order
 * response.
 */
async function notifyCommittedOrder(order: any, orderId: string) {
    const customerEmail = String(order?.email || order?.guestEmail || '').trim();
    const recipients = getAdminNotificationRecipients();
    const tasks: Promise<any>[] = [];

    if (customerEmail) {
        tasks.push((async () => {
            try {
                await sendOrderConfirmationEmail(order, {});
                await pool.execute('UPDATE orders SET confirmationEmailSentAt = NOW(), confirmationEmailAccepted = 1 WHERE orderId = ?', [orderId]);
                console.info(`Order confirmation accepted for ${orderId}`);
            }
            catch (error) {
                logEmailFailure('Order confirmation', orderId, error);
                try {
                    await pool.execute('UPDATE orders SET confirmationEmailAccepted = 0 WHERE orderId = ?', [orderId]);
                }
                catch (updateError) {
                    console.error(`Could not record confirmation failure for ${orderId}: ${getEmailFailureCode(updateError)}`);
                }
            }
        })());
    }

    if (recipients.length > 0) {
        tasks.push((async () => {
            try {
                await sendAdminNewOrderEmail(order, recipients);
                console.info(`Admin new-order notification accepted for ${orderId}`);
            }
            catch (error) {
                logEmailFailure('Admin new order', orderId, error);
            }
        })());
    } else {
        console.error(`Admin new order email failed for order ${orderId}: NEW_ORDER_RECIPIENT_NOT_CONFIGURED`);
    }

    await Promise.allSettled(tasks);
}
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
    const customerName = o.customerName || shipAddr.fullName || shipAddr.name || (o.guestEmail ? o.guestEmail.split('@')[0] : '') || 'Customer';
    const email = o.guestEmail || o.email || '';
    const phone = o.guestPhone || o.phone || shipAddr.phone || '';
    return {
        ...o,
        shippingAddress: {
            fullName: shipAddr.fullName || shipAddr.name || customerName,
            phone: shipAddr.phone || phone,
            street: shipAddr.street || shipAddr.address || '',
            city: shipAddr.city || '',
            province: shipAddr.province || shipAddr.state || '',
            notes: shipAddr.notes || o.notes || '',
            ...shipAddr
        },
        customerName,
        email,
        phone,
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
                const s = status.trim();
                if (s === 'Order Confirmed' || s === 'Processing') {
                    conditions.push('(status = ? OR status = ?)');
                    params.push('Order Confirmed', 'Processing');
                } else {
                    conditions.push('status = ?');
                    params.push(s);
                }
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
// Helper for public order tracking
async function handlePublicOrderTrack(req: Request, res: Response) {
    try {
        const orderIdentifier = String(req.body?.orderId || req.body?.order || req.body?.trackingNumber || req.query?.orderId || req.query?.order || req.query?.trackingNumber || '').trim();
        const rawPhone = String(req.body?.phone || req.query?.phone || '').trim();

        if (!orderIdentifier) {
            return res.status(400).json({ error: 'Please enter your order number or tracking code.' });
        }

        // Search by orderId, internal id, or courier trackingNumber
        const [orders] = await pool.execute(
            `SELECT ${ORDER_COLS} FROM orders WHERE orderId = ? OR id = ? OR trackingNumber = ?`,
            [orderIdentifier, orderIdentifier, orderIdentifier]
        );

        const ordersArr = orders as any[];
        if (ordersArr.length === 0) {
            return res.status(404).json({ error: 'No order found matching these details. Please check your order number or tracking code.' });
        }

        const order = ordersArr[0];
        const shipAddr = typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : (order.shippingAddress || {});

        // If phone is provided, verify it matches
        if (rawPhone) {
            const cleanDigits = (val: string) => String(val || '').replace(/\D/g, '');
            const phoneDigits = cleanDigits(rawPhone);
            if (phoneDigits.length >= 7) {
                const dbPhone1 = cleanDigits(order.guestPhone);
                const dbPhone2 = cleanDigits(shipAddr.phone);
                const targetTail = phoneDigits.slice(-9);

                const phoneMatches = 
                    (targetTail.length >= 7 && dbPhone1.endsWith(targetTail)) ||
                    (targetTail.length >= 7 && dbPhone2.endsWith(targetTail)) ||
                    (dbPhone1.length >= 7 && phoneDigits.endsWith(dbPhone1.slice(-9))) ||
                    (dbPhone2.length >= 7 && phoneDigits.endsWith(dbPhone2.slice(-9))) ||
                    dbPhone1 === phoneDigits ||
                    dbPhone2 === phoneDigits;

                if (!phoneMatches) {
                    return res.status(404).json({ error: 'The mobile number does not match this order. Please verify your details.' });
                }
            }
        }

        const fullOrder = await getFullOrder(pool, order.orderId);
        if (!fullOrder) {
            return res.status(404).json({ error: 'Order details could not be retrieved.' });
        }

        const mapped = mapOrderForFrontend(fullOrder);
        const rawStatus = mapped.status || 'Pending';
        const displayStatus = rawStatus === 'Processing' ? 'Order Confirmed' : rawStatus;
        const isCancelled = displayStatus === 'Cancelled';

        // Real timeline stages
        const stages = [
            {
                key: 'placed',
                label: 'Order Placed',
                description: 'We have received your order.',
                completed: true,
                current: displayStatus === 'Pending',
                date: fullOrder.createdAt
            },
            {
                key: 'confirmed',
                label: 'Order Confirmed',
                description: 'Order confirmed and in preparation.',
                completed: ['Order Confirmed', 'Processing', 'Shipped', 'Delivered'].includes(displayStatus),
                current: displayStatus === 'Order Confirmed' || displayStatus === 'Processing',
                date: fullOrder.statusHistory?.find((h: any) => h.status === 'Order Confirmed' || h.status === 'Processing')?.timestamp || null
            },
            {
                key: 'shipped',
                label: 'Shipped',
                description: fullOrder.trackingNumber ? `Handed over to courier (Tracking: ${fullOrder.trackingNumber})` : 'Order dispatched with courier.',
                completed: ['Shipped', 'Delivered'].includes(displayStatus),
                current: displayStatus === 'Shipped',
                date: fullOrder.statusHistory?.find((h: any) => h.status === 'Shipped')?.timestamp || null
            },
            {
                key: 'delivered',
                label: 'Delivered',
                description: 'Order successfully delivered to customer.',
                completed: displayStatus === 'Delivered',
                current: displayStatus === 'Delivered',
                date: fullOrder.statusHistory?.find((h: any) => h.status === 'Delivered')?.timestamp || null
            }
        ];

        return res.json({
            orderNumber: fullOrder.orderId,
            orderId: fullOrder.orderId,
            date: mapped.date || fullOrder.createdAt,
            createdAt: fullOrder.createdAt,
            status: displayStatus,
            isCancelled,
            trackingNumber: fullOrder.trackingNumber || null,
            city: shipAddr.city || '',
            province: shipAddr.province || shipAddr.state || '',
            paymentMethod: fullOrder.paymentMethod || 'Cash on Delivery (COD)',
            deliveryEstimate: '2–4 working days',
            subtotal: mapped.subtotal,
            shippingFee: mapped.shippingFee,
            discountAmount: mapped.discountAmount,
            total: mapped.total,
            items: (mapped.items || []).map((item: any) => ({
                name: item.name || item.productName || 'LEVA Product',
                quantity: Number(item.quantity || 1),
                price: Number(item.price || 0),
                total: Number(item.price || 0) * Number(item.quantity || 1),
                image: item.image || '',
                selectedVariant: item.selectedVariant || null
            })),
            stages,
            statusHistory: (fullOrder.statusHistory || []).map((h: any) => ({
                status: h.status === 'Processing' ? 'Order Confirmed' : h.status,
                note: h.note || '',
                timestamp: h.timestamp
            }))
        });
    } catch (err: any) {
        console.error('Order tracking error:', err);
        return res.status(500).json({ error: 'Unable to track order right now. Please try again.' });
    }
}
router.post('/track', handlePublicOrderTrack);
router.get('/track', handlePublicOrderTrack);

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
        const submittedEmail = typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim() : '';
        const isAdminUser = ['admin', 'super_admin'].includes(req.user?.role || '');
        const isCustomerUser = req.user?.role === 'customer';
        // For authenticated customers, link their customer account and use their account email.
        // For guests or when an admin is logged in placing a test order, NEVER use admin email/account;
        // preserve the submitted customer checkout details.
        const email = (isCustomerUser && req.user?.email) ? req.user.email : submittedEmail;
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
            if (existing[0].guestPhone !== phone || (!isAdminUser && (existing[0].user_id || null) !== (req.user?.userId || null)))
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
        const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
        // Associate with customerUserId ONLY if authenticated user is an actual customer, not an admin
        let customerUserId = isCustomerUser ? (req.user?.userId || null) : null;
        if (!customerUserId && normalizedEmail) {
            try {
                const [userRows]: any = await conn.execute('SELECT id, phone, role FROM users WHERE email = ?', [normalizedEmail]);
                if (userRows && userRows.length > 0) {
                    if (userRows[0].role === 'customer') {
                        customerUserId = userRows[0].id;
                        if (!userRows[0].phone && phone) {
                            await conn.execute('UPDATE users SET phone = ?, updatedAt = ? WHERE id = ?', [phone, now, customerUserId]);
                        }
                    }
                } else {
                    customerUserId = crypto.randomBytes(12).toString('hex');
                    const randomPassword = crypto.randomBytes(16).toString('hex');
                    const passwordHash = await bcrypt.hash(randomPassword, 10);
                    const userName = customerName && String(customerName).trim() ? String(customerName).trim() : normalizedEmail.split('@')[0];
                    await conn.execute(
                        'INSERT INTO users (id, name, email, phone, passwordHash, role, wishlist, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [customerUserId, userName, normalizedEmail, phone || null, passwordHash, 'customer', '[]', now, now]
                    );
                }
            } catch (userErr) {
                console.warn('Auto customer account creation warning:', userErr);
            }
        }
        const fullShippingAddress = {
            ...shippingAddress,
            fullName: customerName.trim(),
            phone: phone.trim(),
            street: shippingAddress.street || '',
            city: shippingAddress.city || '',
            province: shippingAddress.province || shippingAddress.state || '',
            notes: shippingAddress.notes || req.body.notes || ''
        };
        await conn.execute('INSERT INTO orders (id,orderId,user_id,guestEmail,guestPhone,total,subtotal,shippingFee,discountAmount,status,paymentMethod,shippingAddress,appliedCoupon,checkoutRequestId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [internalId, orderId, customerUserId, normalizedEmail, phone, totals.total, totals.subtotal, totals.shippingFee, totals.discount, 'Pending', 'COD', JSON.stringify(fullShippingAddress), coupon ? JSON.stringify({ code: coupon }) : null, requestId, now, now]);
        for (const item of totals.items)
            await conn.execute('INSERT INTO order_items (id,order_id,productId,productName,quantity,price,image,selectedVariant,variationId,routineComponents) VALUES (?,?,?,?,?,?,?,?,?,?)', [crypto.randomBytes(12).toString('hex'), internalId, item.productId, item.productName, item.quantity, item.price, item.image, item.selectedVariant, item.variationId, item.routineComponents ? JSON.stringify(item.routineComponents) : null]);
        await conn.execute('INSERT INTO order_status_history (id,order_id,status,note,timestamp) VALUES (?,?,?,?,?)', [crypto.randomBytes(12).toString('hex'), internalId, 'Pending', 'Order placed', now]);
        await conn.commit();
        committed = true;
        const dbOrder = await getFullOrder(pool, orderId);
        const newOrder = dbOrder ? mapOrderForFrontend(dbOrder) : null;
        // Email dispatch must finish before a serverless invocation returns;
        // its failures are isolated from the already-committed order.
        await notifyCommittedOrder(newOrder, orderId);

        // Marketing events remain best-effort and never affect checkout.
        const metaEventId = `purchase_${orderId}`;
        void (async () => {
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
        const jwtSecret = process.env.JWT_SECRET;
        let customerToken = '';
        if (jwtSecret && normalizedEmail && customerUserId) {
            customerToken = jwt.sign({ userId: customerUserId, email: normalizedEmail, role: 'customer' }, jwtSecret, { expiresIn: '7d' });
            if (!isAdminUser) {
                res.cookie(sessionCookieName(), customerToken, {
                    ...sessionCookieOptions(),
                    maxAge: 7 * 24 * 60 * 60 * 1000
                });
            }
        }
        const customerUser = customerUserId ? {
            id: customerUserId,
            name: (customerName && String(customerName).trim()) || (normalizedEmail ? normalizedEmail.split('@')[0] : 'Customer'),
            email: normalizedEmail || '',
            phone: phone || ''
        } : null;
        res.status(201).json({ ...newOrder, customerToken, customerUser });
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
        const validStatuses = ['Pending', 'Order Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
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
