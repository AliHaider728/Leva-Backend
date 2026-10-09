import crypto from "crypto";
import type { Request } from "express";

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE;

// Keep this configurable so you can update Meta's Graph API version
// without rewriting application code.
const GRAPH_API_VERSION =
  process.env.META_GRAPH_API_VERSION || "v23.0";

const sha256 = (value?: string | null) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) return undefined;

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
};

const normalizePhone = (phone?: string) => {
  let value = String(phone || "").replace(/\D/g, "");

  if (!value) return "";

  // Pakistan: 03xxxxxxxxx -> 923xxxxxxxxx
  if (value.startsWith("0") && value.length === 11) {
    value = `92${value.slice(1)}`;
  }

  return value;
};

const getClientIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0];
  }

  return req.ip;
};

export const sendMetaPurchase = async ({
  order,
  req,
  eventId,
}: {
  order: any;
  req: Request;
  eventId: string;
}) => {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn(
      "[Meta CAPI] META_PIXEL_ID or META_CAPI_ACCESS_TOKEN is missing."
    );
    return;
  }

  const fullName = String(order.customerName || "").trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);

  const firstName = nameParts[0] || "";
  const lastName =
    nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  const address = order.shippingAddress || {};

  const userData: Record<string, unknown> = {};

  if (order.email) {
    userData.em = [sha256(order.email)];
  }

  if (order.phone) {
    const normalizedPhone = normalizePhone(order.phone);

    if (normalizedPhone) {
      userData.ph = [sha256(normalizedPhone)];
    }
  }

  if (firstName) {
    userData.fn = [sha256(firstName)];
  }

  if (lastName) {
    userData.ln = [sha256(lastName)];
  }

  if (address.city) {
    userData.ct = [sha256(address.city)];
  }

  if (address.state) {
    userData.st = [sha256(address.state)];
  }

  if (address.postalCode) {
    userData.zp = [sha256(address.postalCode)];
  }

  if (address.country) {
    // Meta expects a 2-letter lowercase country code.
    const country =
      String(address.country).trim().toLowerCase() === "pakistan"
        ? "pk"
        : String(address.country).trim().toLowerCase();

    userData.country = [sha256(country)];
  }

  const clientIp = getClientIp(req);

  if (clientIp) {
    userData.client_ip_address = clientIp;
  }

  if (req.headers["user-agent"]) {
    userData.client_user_agent = req.headers["user-agent"];
  }

  const event = {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),

    // Must match browser Pixel Purchase
    event_id: eventId,

    action_source: "website",
    event_source_url: req.headers.referer || "https://alvora.pk/checkout",

    user_data: userData,

    custom_data: {
      currency: "PKR",
      value: Number(order.total),

      content_type: "product",

      content_ids: order.items.map((item: any) =>
        String(item.productId)
      ),

      contents: order.items.map((item: any) => ({
        id: String(item.productId),
        quantity: Number(item.quantity),
        item_price: Number(item.price),
      })),

      num_items: order.items.reduce(
        (total: number, item: any) =>
          total + Number(item.quantity),
        0
      ),

      order_id: order.orderId,
    },
  };

  const body: Record<string, unknown> = {
    data: [event],
  };

  if (TEST_EVENT_CODE) {
    body.test_event_code = TEST_EVENT_CODE;
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(
      ACCESS_TOKEN
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("[Meta CAPI] Purchase failed:", result);
    throw new Error("Meta Conversions API request failed");
  }

  console.log(
    `[Meta CAPI] Purchase sent for order ${order.orderId}`,
    result
  );
};