import nodemailer from 'nodemailer';

const REQUIRED_SMTP_ENVIRONMENT_VARIABLES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM'
] as const;

export interface EmailDispatchResult {
  messageId: string;
  acceptedCount: number;
  rejectedCount: number;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export class EmailDispatchError extends Error {
  code: string;

  constructor(code: string) {
    super('Email delivery failed');
    this.name = 'EmailDispatchError';
    this.code = code;
  }
}

export const getMissingEmailEnvironmentVariables = () =>
  REQUIRED_SMTP_ENVIRONMENT_VARIABLES.filter(name => !process.env[name]?.trim());

export const getEmailFailureCode = (error: unknown) => {
  if (error instanceof EmailDispatchError) return error.code;
  const rawCode = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return /^[A-Z0-9_-]{1,80}$/i.test(rawCode) ? rawCode : 'SMTP_SEND_FAILED';
};

const createTransporter = () => {
  const missing = getMissingEmailEnvironmentVariables();
  if (missing.length > 0) throw new EmailDispatchError('SMTP_NOT_CONFIGURED');

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new EmailDispatchError('SMTP_PORT_INVALID');

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatPkr = (value: unknown) =>
  `Rs. ${Math.max(0, Number(value) || 0).toLocaleString('en-PK')}`;

const formatDeliveryDate = (value: unknown) => {
  const date = value ? new Date(String(value)) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Karachi'
  });
};

const sendEmail = async (to: string, content: EmailContent): Promise<EmailDispatchResult> => {
  try {
    const info = await createTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: 'sales@alvora.pk'
    });
    const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
    const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;
    if (!info.messageId || acceptedCount === 0) {
      throw new EmailDispatchError('SMTP_NOT_ACCEPTED');
    }
    return {
      messageId: String(info.messageId),
      acceptedCount,
      rejectedCount
    };
  } catch (error) {
    if (error instanceof EmailDispatchError) throw error;
    throw new EmailDispatchError(getEmailFailureCode(error));
  }
};

export const verifyEmailTransport = async () => {
  try {
    await createTransporter().verify();
    return true;
  } catch (error) {
    if (error instanceof EmailDispatchError) throw error;
    throw new EmailDispatchError(getEmailFailureCode(error));
  }
};

const routineContentsText = (item: any) => (Array.isArray(item.routineComponents) ? item.routineComponents : []).map((c: any) => c.quantity + ' x ' + c.name + (c.selectedVariant ? ' (' + c.selectedVariant + ')' : '')).join('; ');
const routineContentsHtml = (item: any) => routineContentsText(item) ? '<div style="color:#64748b;font-size:12px;margin-top:4px;">Includes: ' + escapeHtml(routineContentsText(item)) + '</div>' : '';

export const buildOrderDeliveredEmail = (order: any): EmailContent => {
  const customerName = escapeHtml(order.customerName || order.shippingAddress?.fullName || 'Customer');
  const orderId = escapeHtml(order.orderId || 'Order');
  const deliveryDate = formatDeliveryDate(order.deliveredAt || new Date());
  const items = Array.isArray(order.items) ? order.items : [];
  const itemRows = items.map((item: any) => {
    const itemName = escapeHtml(item.name || 'Alvora product');
    const variant = item.selectedVariant
      ? `<div style="color:#64748b;font-size:12px;margin-top:4px;">${escapeHtml(item.selectedVariant)}</div>`
      : '';
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <strong style="color:#0f172a;">${itemName}</strong>${variant}${routineContentsHtml(item)}
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#475569;">${Math.max(1, Number(item.quantity) || 1)}</td>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-weight:700;">${formatPkr((Number(item.price) || 0) * Math.max(1, Number(item.quantity) || 1))}</td>
      </tr>`;
  }).join('');
  const productNames = items.map((item: any) => String(item.name || 'Alvora product')).join(', ');
  const total = formatPkr(order.total);
  const subject = `Your Alvora Order Has Been Delivered - ${String(order.orderId || 'Order')}`;

  const html = `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#334155;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
            <tr><td style="background:#ffffff;padding:36px 28px 24px;text-align:center;border-bottom:1px solid #f1f5f9;">
              <img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 12px;display:block;" />
              <p style="color:#64748b;margin:0;font-size:15px;font-weight:500;letter-spacing:0.5px;">Delivered with smiles</p>
            </td></tr>
            <tr><td style="padding:32px 28px;">
              <h2 style="color:#0f172a;font-size:24px;margin:0 0 16px;">Your order has been delivered!</h2>
              <p style="margin:0 0 12px;line-height:1.6;">Hi <strong>${customerName}</strong>,</p>
              <p style="margin:0 0 22px;line-height:1.6;">Great news—your Alvora order <strong>#${orderId}</strong> was delivered on <strong>${escapeHtml(deliveryDate)}</strong>.</p>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:16px;margin-bottom:22px;">
                <strong style="color:#166534;">Delivery confirmed</strong>
                <div style="color:#15803d;font-size:13px;margin-top:4px;">We hope you enjoy your new skincare routine.</div>
              </div>
              <h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Order summary</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr style="color:#64748b;font-size:12px;text-transform:uppercase;">
                  <th align="left" style="padding-bottom:8px;">Product</th><th style="padding-bottom:8px;">Qty</th><th align="right" style="padding-bottom:8px;">Amount</th>
                </tr>
                ${itemRows}
              </table>
              <p style="font-size:18px;text-align:right;color:#e11d48;font-weight:800;margin:18px 0 26px;">Total: ${total}</p>
              <p style="line-height:1.6;margin:0 0 12px;">If anything is missing or damaged, reply to this email or contact <a href="mailto:sales@alvora.pk" style="color:#e11d48;">sales@alvora.pk</a>.</p>
              <p style="line-height:1.6;margin:0;">Thank you for choosing Alvora!</p>
            </td></tr>
            <tr><td style="background:#f8fafc;padding:18px 28px;text-align:center;color:#94a3b8;font-size:12px;">Alvora · Customer Support: sales@alvora.pk</td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;

  const text = [
    'Alvora - Your order has been delivered!',
    `Hi ${String(order.customerName || order.shippingAddress?.fullName || 'Customer')},`,
    `Order #${String(order.orderId || 'Order')} was delivered on ${deliveryDate}.`,
    `Products: ${productNames || 'Alvora product'}`,
    `Total: ${total}`,
    'Need help? Reply to this email or contact sales@alvora.pk.'
  ].join('\n\n');

  return { subject, html, text };
};

export const sendOrderDeliveredEmail = (order: any) =>
  sendEmail(String(order.email || ''), buildOrderDeliveredEmail(order));

export const buildOrderConfirmationEmail = (order: any, options?: { isNewAccount?: boolean; rawPassword?: string }): EmailContent => {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.map((item: any) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const variant = item.selectedVariant ? ` (${String(item.selectedVariant)})` : '';
    return `${String(item.name || 'Alvora product')}${variant} x ${quantity} at ${formatPkr(item.price)}${routineContentsText(item) ? " — Includes: " + routineContentsText(item) : ""}`;
  }).join('\n');
  const itemsHtml = items.map((item: any) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const itemPrice = Number(item.price) || 0;
    const variant = item.selectedVariant
      ? `<div style="color:#64748b;font-size:12px;margin-top:4px;">${escapeHtml(item.selectedVariant)}</div>`
      : '';
    return `<tr>
      <td style="padding:13px 0;border-bottom:1px solid #e2e8f0;"><strong style="color:#0f172a;">${escapeHtml(item.name || 'Alvora product')}</strong>${variant}${routineContentsHtml(item)}</td>
      <td style="padding:13px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#475569;">${quantity}</td>
      <td style="padding:13px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#475569;">${formatPkr(itemPrice)}</td>
      <td style="padding:13px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-weight:700;">${formatPkr(itemPrice * quantity)}</td>
    </tr>`;
  }).join('');
  const address = order.shippingAddress || {};
  const fullAddress = [address.street, address.city, address.state, address.postalCode, address.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
  const customerName = String(order.customerName || address.fullName || 'Customer');
  const orderId = String(order.orderId || 'Order');
  const orderDate = formatDeliveryDate(order.createdAt || order.date || new Date());
  const paymentMethod = String(order.paymentMethod || 'Cash on Delivery (COD)');
  const orderStatus = String(order.status || 'Pending');
  const contactPhone = String(address.phone || order.phone || '').trim();
  const discount = Math.max(0, Number(order.discountAmount) || 0);
  const discountHtml = discount > 0
    ? `<tr><td style="padding:5px 0;color:#64748b;">Discount</td><td style="padding:5px 0;text-align:right;color:#15803d;font-weight:700;">-${formatPkr(discount)}</td></tr>`
    : '';
  const subject = `Your Alvora Order Is Confirmed - ${orderId}`;
  const html = `<!doctype html>
  <html lang="en"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#334155;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
        <tr><td style="background:#ffffff;padding:36px 28px 24px;text-align:center;border-bottom:1px solid #f1f5f9;">
          <img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 12px;display:block;" />
          <p style="color:#64748b;margin:0;font-size:15px;font-weight:500;letter-spacing:0.5px;">Healthy Skin. Naturally You.</p>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h2 style="color:#0f172a;font-size:24px;margin:0 0 16px;">Your order is confirmed!</h2>
          <p style="margin:0 0 12px;line-height:1.6;">Hi <strong>${escapeHtml(customerName)}</strong>,</p>
          <p style="margin:0 0 20px;line-height:1.6;">Thank you for shopping with Alvora. We have received order <strong>#${escapeHtml(orderId)}</strong> placed on <strong>${escapeHtml(orderDate)}</strong>.</p>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:16px;margin-bottom:22px;"><strong style="color:#1d4ed8;">What happens next?</strong><div style="color:#1e40af;font-size:13px;line-height:1.5;margin-top:4px;">Our team will contact you to confirm the order before it is dispatched.</div></div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px;background:#f8fafc;border-radius:12px;padding:12px;">
            <tr><td style="padding:5px;color:#64748b;">Order number</td><td style="padding:5px;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(orderId)}</td></tr>
            <tr><td style="padding:5px;color:#64748b;">Order date</td><td style="padding:5px;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(orderDate)}</td></tr>
            <tr><td style="padding:5px;color:#64748b;">Status</td><td style="padding:5px;text-align:right;font-weight:700;color:#b45309;">${escapeHtml(orderStatus)}</td></tr>
            <tr><td style="padding:5px;color:#64748b;">Payment</td><td style="padding:5px;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(paymentMethod)}</td></tr>
          </table>
          <h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Order summary</h3>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr style="color:#64748b;font-size:11px;text-transform:uppercase;"><th align="left" style="padding-bottom:8px;">Product</th><th style="padding-bottom:8px;">Qty</th><th align="right" style="padding-bottom:8px;">Price</th><th align="right" style="padding-bottom:8px;">Amount</th></tr>${itemsHtml}</table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 24px;">
            <tr><td style="padding:5px 0;color:#64748b;">Subtotal</td><td style="padding:5px 0;text-align:right;font-weight:700;">${formatPkr(order.subtotal)}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">Delivery charges</td><td style="padding:5px 0;text-align:right;font-weight:700;">${formatPkr(order.deliveryCharge)}</td></tr>${discountHtml}
            <tr><td style="padding:10px 0 0;color:#0f172a;font-size:17px;font-weight:800;">Final total</td><td style="padding:10px 0 0;text-align:right;color:#e11d48;font-size:19px;font-weight:900;">${formatPkr(order.total)}</td></tr>
          </table>
          <div style="background:#f8fafc;border-radius:14px;padding:16px;margin-bottom:22px;"><h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Delivery address</h3><p style="margin:0;line-height:1.6;color:#334155;"><strong>${escapeHtml(address.fullName || customerName)}</strong><br/>${escapeHtml(fullAddress)}${contactPhone ? `<br/>Phone: ${escapeHtml(contactPhone)}` : ''}</p></div>
          ${options?.isNewAccount ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:14px;padding:16px;margin-bottom:22px;"><h3 style="color:#b45309;font-size:16px;margin:0 0 8px;">Your Alvora account has been created</h3><p style="margin:0 0 12px;line-height:1.6;color:#92400e;">A Alvora account has been created for you automatically. You are already signed in on this device, so you can start managing your orders immediately. A temporary password has also been generated for future sign-ins. For security, you can change it anytime from the Password section in your Profile.</p><p style="margin:0 0 4px;color:#92400e;"><strong>Email:</strong> ${escapeHtml(String(order.email || ''))}</p><p style="margin:0 0 16px;color:#92400e;"><strong>Temporary Password:</strong> ${escapeHtml(options.rawPassword || '')}</p><a href="${process.env.FRONTEND_URL || 'https://play-bimboo.vercel.app'}/profile" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;">View Your Profile</a></div>` : (options?.isNewAccount === false ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:16px;margin-bottom:22px;"><h3 style="color:#15803d;font-size:16px;margin:0 0 8px;">Track your order</h3><p style="margin:0 0 12px;line-height:1.6;color:#166534;">You already have an account with us. Log in with your existing credentials to track this order.</p><a href="${process.env.FRONTEND_URL || 'https://play-bimboo.vercel.app'}/login" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;">Log In to Track Order</a></div>` : '')}
          <p style="line-height:1.6;margin:0 0 12px;">Questions about your order? Reply to this email or contact <a href="mailto:sales@alvora.pk" style="color:#e11d48;">sales@alvora.pk</a>.</p><p style="line-height:1.6;margin:0;">Thank you for choosing Alvora!</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:18px 28px;text-align:center;color:#94a3b8;font-size:12px;">Alvora &middot; Customer Support: sales@alvora.pk</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  const text = [
    'Alvora - Your order is confirmed!', `Hi ${customerName},`,
    `Order #${orderId} was placed on ${orderDate}.`, `Status: ${orderStatus}`, `Payment: ${paymentMethod}`,
    `Products:\n${itemLines || 'Alvora product'}`, `Subtotal: ${formatPkr(order.subtotal)}`,
    `Delivery charges: ${formatPkr(order.deliveryCharge)}`,
    ...(discount > 0 ? [`Discount: -${formatPkr(discount)}`] : []),
    `Final total: ${formatPkr(order.total)}`,
    `Delivery address: ${String(address.fullName || customerName)}, ${fullAddress}${contactPhone ? `, Phone: ${contactPhone}` : ''}`,
    ...(options?.isNewAccount ? [
      '--- YOUR NEW ACCOUNT ---',
      'A Alvora account has been created for you automatically. You are already signed in on this device, so you can start managing your orders immediately. A temporary password has also been generated for future sign-ins. For security, you can change it anytime from the Password section in your Profile.',
      `Email: ${String(order.email || '')}`,
      `Temporary Password: ${options.rawPassword || ''}`,
      '-------------------------'
    ] : (options?.isNewAccount === false ? [
      '--- TRACK YOUR ORDER ---',
      'You already have an account with us. Log in with your existing credentials to track this order.',
      '------------------------'
    ] : [])),
    'Our team will contact you to confirm the order before it is dispatched.',
    'Need help? Reply to this email or contact sales@alvora.pk.'
  ].join('\n\n');
  return { subject, html, text };
};

export const sendOrderConfirmationEmail = (order: any, options?: { isNewAccount?: boolean; rawPassword?: string }) =>
  sendEmail(String(order.email || ''), buildOrderConfirmationEmail(order, options));

export const sendOrderStatusEmail = async (order: any) => {
  const content: EmailContent = {
    subject: `Order Update #${String(order.orderId || 'Order')} - ${String(order.status || 'Updated')}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;border:1px solid #e2e8f0;border-radius:16px;"><img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 24px;display:block;" /><h2 style="color:#0f172a;text-align:center;margin:0 0 24px;">Order Update</h2><p>Hi <strong>${escapeHtml(order.customerName || 'Customer')}</strong>,</p><p>Order <strong>#${escapeHtml(order.orderId || 'Order')}</strong> is now <strong>${escapeHtml(order.status || 'Updated')}</strong>.</p>${order.trackingNumber ? `<p>Tracking code: <strong>${escapeHtml(order.trackingNumber)}</strong></p>` : ''}<br/><p>Support: <a href="mailto:sales@alvora.pk" style="color:#e11d48;">sales@alvora.pk</a></p></div>`,
    text: `Alvora order #${String(order.orderId || 'Order')} is now ${String(order.status || 'Updated')}. Support: sales@alvora.pk.`
  };
  return sendEmail(String(order.email || ''), content);
};

export const getAdminNotificationRecipients = (): string[] => {
  const raw = process.env.NEW_ORDER_NOTIFICATION_EMAILS || '';
  let emails = raw.split(',').map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  
  if (emails.length === 0) {
    const fallbackUser = process.env.SMTP_USER || '';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallbackUser)) {
      emails.push(fallbackUser);
    } else {
      const fallbackFromMatch = (process.env.SMTP_FROM || '').match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/i);
      if (fallbackFromMatch && fallbackFromMatch[0]) {
        emails.push(fallbackFromMatch[0]);
      }
    }
  }
  return Array.from(new Set(emails));
};

export const buildAdminNewOrderEmail = (order: any): EmailContent => {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map((item: any) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const itemPrice = Number(item.price) || 0;
    const variant = item.selectedVariant
      ? `<div style="color:#64748b;font-size:12px;margin-top:4px;">${escapeHtml(item.selectedVariant)}</div>`
      : '';
    const skuHtml = item.sku ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">SKU: ${escapeHtml(item.sku)}</div>` : '';
    return `<tr>
      <td style="padding:13px 0;border-bottom:1px solid #e2e8f0;"><strong style="color:#0f172a;">${escapeHtml(item.name || 'Product')}</strong>${variant}${skuHtml}${routineContentsHtml(item)}</td>
      <td style="padding:13px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#475569;">${quantity}</td>
      <td style="padding:13px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#475569;">${formatPkr(itemPrice)}</td>
      <td style="padding:13px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-weight:700;">${formatPkr(itemPrice * quantity)}</td>
    </tr>`;
  }).join('');
  
  const address = order.shippingAddress || {};
  const fullAddress = [address.street, address.city, address.state, address.postalCode, address.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
  
  const customerName = String(order.customerName || address.fullName || 'Customer');
  const orderId = String(order.orderId || 'Order');
  const orderDate = formatDeliveryDate(order.createdAt || order.date || new Date());
  const paymentMethod = String(order.paymentMethod || 'Cash on Delivery (COD)');
  const orderStatus = String(order.status || 'Pending');
  const contactPhone = String(address.phone || order.phone || '').trim();
  const customerEmail = String(order.email || '').trim();
  const discount = Math.max(0, Number(order.discountAmount) || 0);
  const discountHtml = discount > 0
    ? `<tr><td style="padding:5px 0;color:#64748b;">Discount</td><td style="padding:5px 0;text-align:right;color:#15803d;font-weight:700;">-${formatPkr(discount)}</td></tr>`
    : '';

  const adminUrlBase = process.env.ADMIN_APP_URL || process.env.FRONTEND_URL || '';
  const adminOrderUrl = adminUrlBase ? `${adminUrlBase.replace(/\/$/, '')}/admin/orders/${orderId}` : '/admin/orders';
  const subject = `New Alvora Order Received - ${orderId} - ${formatPkr(order.total)}`;
  
  const html = `<!doctype html>
  <html lang="en"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#334155;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
        <tr><td style="background:#ffffff;padding:36px 28px 24px;text-align:center;border-bottom:1px solid #f1f5f9;">
          <img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 16px;display:block;" />
          <h1 style="color:#0f172a;font-size:22px;margin:0;">You've received a new order</h1>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Order summary</h3>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px;background:#f8fafc;border-radius:12px;padding:12px;">
            <tr><td style="padding:5px;color:#64748b;">Order number</td><td style="padding:5px;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(orderId)}</td></tr>
            <tr><td style="padding:5px;color:#64748b;">Order date</td><td style="padding:5px;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(orderDate)}</td></tr>
            <tr><td style="padding:5px;color:#64748b;">Status</td><td style="padding:5px;text-align:right;font-weight:700;color:#b45309;">${escapeHtml(orderStatus)}</td></tr>
            <tr><td style="padding:5px;color:#64748b;">Payment</td><td style="padding:5px;text-align:right;font-weight:700;color:${paymentMethod.includes('COD') ? '#e11d48' : '#0f172a'};">${escapeHtml(paymentMethod)}</td></tr>
          </table>

          <h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Customer details</h3>
          <div style="background:#f8fafc;border-radius:14px;padding:16px;margin-bottom:22px;">
            <p style="margin:0;line-height:1.6;color:#334155;">
              <strong>Name:</strong> ${escapeHtml(customerName)}<br/>
              <strong>Email:</strong> ${escapeHtml(customerEmail)}<br/>
              <strong>Phone:</strong> ${escapeHtml(contactPhone)}
            </p>
          </div>

          <h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Delivery details</h3>
          <div style="background:#f8fafc;border-radius:14px;padding:16px;margin-bottom:22px;">
            <p style="margin:0;line-height:1.6;color:#334155;">
              ${escapeHtml(fullAddress)}
              ${order.shippingAddress?.instructions ? `<br/><br/><strong>Instructions:</strong> ${escapeHtml(order.shippingAddress.instructions)}` : ''}
            </p>
          </div>

          <h3 style="color:#0f172a;font-size:16px;margin:0 0 8px;">Order items</h3>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr style="color:#64748b;font-size:11px;text-transform:uppercase;"><th align="left" style="padding-bottom:8px;">Product</th><th style="padding-bottom:8px;">Qty</th><th align="right" style="padding-bottom:8px;">Price</th><th align="right" style="padding-bottom:8px;">Amount</th></tr>${itemsHtml}</table>
          
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 24px;">
            <tr><td style="padding:5px 0;color:#64748b;">Subtotal</td><td style="padding:5px 0;text-align:right;font-weight:700;">${formatPkr(order.subtotal)}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">Delivery charges</td><td style="padding:5px 0;text-align:right;font-weight:700;">${formatPkr(order.deliveryCharge)}</td></tr>${discountHtml}
            <tr><td style="padding:10px 0 0;color:#0f172a;font-size:17px;font-weight:800;">Final total</td><td style="padding:10px 0 0;text-align:right;color:#e11d48;font-size:19px;font-weight:900;">${formatPkr(order.total)}</td></tr>
          </table>

          <div style="text-align:center;margin-top:32px;">
            <a href="${escapeHtml(adminOrderUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;">View Order in Admin</a>
          </div>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  const text = [
    `New Alvora Order Received - ${orderId}`,
    `Order Date: ${orderDate}`,
    `Status: ${orderStatus}`,
    `Payment: ${paymentMethod}`,
    '',
    'CUSTOMER DETAILS',
    `Name: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${contactPhone}`,
    '',
    'DELIVERY DETAILS',
    fullAddress,
    '',
    `Total: ${formatPkr(order.total)}`,
    '',
    `View Order in Admin: ${adminOrderUrl}`
  ].join('\n');

  return { subject, html, text };
};

export const sendAdminNewOrderEmail = async (order: any, recipients: string[]) => {
  if (!recipients || recipients.length === 0) {
    throw new EmailDispatchError('NEW_ORDER_RECIPIENT_NOT_CONFIGURED');
  }
  const to = recipients.join(',');
  return sendEmail(to, buildAdminNewOrderEmail(order));
};

export const sendPasswordResetEmail = async (user: any, code: string) => {
  const subject = 'Reset your Alvora password';
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;border:1px solid #e2e8f0;border-radius:16px;padding:32px 24px;">
      <img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 24px;display:block;" />
      <h2 style="color:#0f172a;text-align:center;margin-top:0;">Password Reset</h2>
      <p>Hello ${escapeHtml(user.name)},</p>
      <p>You recently requested to reset your password for your Alvora account. Use the 6-digit verification code below to reset it.</p>
      <div style="margin: 30px 0; text-align: center;">
        <span style="background-color:#f1f5f9;color:#0f172a;padding:16px 32px;border-radius:12px;font-weight:900;font-size:32px;letter-spacing:4px;">${code}</span>
      </div>
      <p>This verification code expires in exactly <strong>30 seconds</strong>.</p>
      <p>If you did not request a password reset, please ignore this email. Your account is safe.</p>
      <p>Thanks,<br>The Alvora Team</p>
    </div>
  `;
  const text = `Hello ${user.name},\n\nYou recently requested to reset your password. Your 6-digit verification code is:\n\n${code}\n\nThis code expires in 30 seconds.\n\nThanks,\nThe Alvora Team`;
  
  return sendEmail(user.email, { subject, html, text });
};

export const sendAccountActivationEmail = async (user: any, token: string) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}&activate=1`;
  const subject = 'Activate Your Alvora Account';
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;border:1px solid #e2e8f0;border-radius:16px;padding:32px 24px;">
      <img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 24px;display:block;" />
      <h2 style="color:#0f172a;text-align:center;margin-top:0;">Welcome!</h2>
      <p>Hello ${escapeHtml(user.name)},</p>
      <p>Thank you for your recent order! We've created an account for you to easily track your orders and manage your wishlist.</p>
      <p>Please click the button below to set your password and activate your account.</p>
      <div style="margin: 30px 0;">
        <a href="${resetUrl}" style="background-color:#e11d48;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;">Set Your Password</a>
      </div>
      <p>This activation link is only valid for the next 24 hours.</p>
      <p>Thanks,<br>The Alvora Team</p>
    </div>
  `;
  const text = `Hello ${user.name},\n\nThank you for your recent order! We've created an account for you to easily track your orders. Please visit the link below to set your password and activate your account:\n${resetUrl}\n\nThanks,\nThe Alvora Team`;
  
  return sendEmail(user.email, { subject, html, text });
};

export const sendContactConfirmationEmail = async (email: string, name: string) => {
  const subject = 'Thank you for contacting Alvora';
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;padding:32px 24px;"><img src="https://pub-fa55f0bf8e7849ed8ba56609eb8c4e60.r2.dev/assets/logo.png" alt="Alvora" style="width:180px;height:auto;margin:0 auto 24px;display:block;" /><h1 style="color:#0f172a;text-align:center;font-size:24px;margin-top:0;">Hello ${name},</h1><p>Thank you for your enquiry. We have received your message and will contact you as soon as possible.</p><br/><p>Best regards,<br/>The Alvora Team</p></div>`;
  const text = `Hello ${name},\n\nThank you for your enquiry. We have received your message and will contact you as soon as possible.\n\nBest regards,\nThe Alvora Team`;
  return sendEmail(email, { subject, html, text });
};
