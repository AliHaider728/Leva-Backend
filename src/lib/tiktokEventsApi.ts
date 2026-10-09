import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Phone normalisation — converts Pakistani local numbers to E.164 (+92...)
// Returns undefined if the number cannot be safely normalised, so we never
// send a malformed value to TikTok.
// ---------------------------------------------------------------------------
const normalizePakistaniPhoneToE164 = (phone: string | undefined | null): string | undefined => {
  if (!phone) return undefined;

  // Strip all non-digit characters (spaces, dashes, parentheses, dots)
  const digits = phone.replace(/\D/g, '');

  // Already E.164 with leading '+92' stripped — 923XXXXXXXXX (12 digits)
  if (/^92[0-9]{10}$/.test(digits)) {
    return `+${digits}`;
  }

  // Local format: 03XXXXXXXXX (11 digits starting with 03)
  if (/^03[0-9]{9}$/.test(digits)) {
    return `+92${digits.slice(1)}`;
  }

  // Short local format: 3XXXXXXXXX (10 digits starting with 3)
  if (/^3[0-9]{9}$/.test(digits)) {
    return `+92${digits}`;
  }

  // Doesn't match any known Pakistani format — skip to avoid bad data
  return undefined;
};

const hashData = (data: string | undefined | null) => {
  if (!data) return undefined;
  const trimmed = data.trim().toLowerCase();
  return crypto.createHash('sha256').update(trimmed).digest('hex');
};

export const sendTikTokPurchase = async ({
  order,
  eventId,
  req,
}: {
  order: any;
  eventId: string;
  req: any;
}) => {
  const pixelId = process.env.TIKTOK_PIXEL_ID;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.warn('[TikTok Events API] Missing TIKTOK_PIXEL_ID or TIKTOK_ACCESS_TOKEN — skipping.');
    return;
  }

  const clientIpAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const clientUserAgent = req.headers['user-agent'];

  const eventTime = Math.floor(Date.now() / 1000);

  // Normalize phone to E.164 before hashing so TikTok can match the hash
  const normalizedPhone = normalizePakistaniPhoneToE164(order.phone);

  const userBlock = {
    email: order.email ? hashData(order.email) : undefined,
    phone_number: normalizedPhone ? hashData(normalizedPhone) : undefined,
    client_ip_address: clientIpAddress,
    client_user_agent: clientUserAgent,
  };

  const eventProperties = {
    contents: order.items.map((item: any) => ({
      content_id: item.productId,
      quantity: item.quantity,
      price: item.price,
    })),
    content_type: 'product',
    value: order.total,
    currency: 'PKR',
  };

  // IMPORTANT: TikTok's Events API requires the field to be named "event",
  // NOT "event_name". Using "event_name" results in code 40002 and the event
  // is silently dropped — this was the root cause of events not appearing.
  const payload: any = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [
      {
        event: 'PlaceAnOrder',      // ← correct field name per TikTok spec
        event_time: eventTime,
        event_id: eventId,
        user: userBlock,
        properties: eventProperties,
      },
      {
        event: 'Purchase',          // ← correct field name per TikTok spec
        event_time: eventTime,
        event_id: eventId,
        user: userBlock,
        properties: eventProperties,
      },
    ],
  };

  // Include test_event_code when env var is set (for TikTok Events Manager testing).
  // Remove or blank TIKTOK_TEST_EVENT_CODE in .env to disable for production.
  const testEventCode = process.env.TIKTOK_TEST_EVENT_CODE;
  if (testEventCode && testEventCode.trim()) {
    payload.test_event_code = testEventCode.trim();
  }

  console.log(`[TikTok Events API] Sending PlaceAnOrder + Purchase for order ${order.orderId} (event_id: ${eventId})`);

  try {
    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.code === 0) {
      console.log(`[TikTok Events API] ✓ Success for order ${order.orderId} — request_id: ${data.request_id}`);
    } else {
      console.error(`[TikTok Events API] ✗ Track failed for order ${order.orderId} — code: ${data.code}, message: ${data.message}, request_id: ${data.request_id}`);
    }
  } catch (error) {
    console.error(`[TikTok Events API] ✗ Fetch error for order ${order.orderId}:`, error);
  }
};
