const assert = require('assert');
const path = require('path');
const https = require('https');

// Import from compiled dist
const mailer = require('../dist/utils/mailer.js');

async function verifyLogoResolution(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      console.log(`Checking Logo URL: ${url} -> Status: ${res.statusCode}, Type: ${res.headers['content-type']}`);
      if (res.statusCode === 200 && res.headers['content-type']?.includes('image')) {
        resolve(true);
      } else {
        reject(new Error(`Logo URL returned ${res.statusCode} (expected 200 with image MIME)`));
      }
    }).on('error', reject);
  });
}

async function runEmailTests() {
  console.log('=== Verifying Centralized LEVA Brand Logo in All Transactional Emails ===');

  const logoUrl = mailer.getLogoUrl();
  console.log('Centralized Logo URL:', logoUrl);
  assert(logoUrl, 'Logo URL must not be empty');

  // Verify that production/CDN logo resolves publicly
  await verifyLogoResolution(logoUrl);
  console.log('PASS: Public logo URL resolves successfully over HTTPS.');

  // Mock order for order-related emails
  const mockOrder = {
    orderId: 'LEV-TEST-001',
    customerName: 'Ayesha Khan',
    email: 'ayesha.test@example.com',
    phone: '03001234567',
    total: 8400,
    subtotal: 8400,
    deliveryCharge: 0,
    discountAmount: 0,
    status: 'Confirmed',
    paymentMethod: 'Cash on Delivery (COD)',
    shippingAddress: {
      fullName: 'Ayesha Khan',
      street: 'House 12, Street 4, Sector F-7/2',
      city: 'Islamabad',
      postalCode: '44000',
      phone: '03001234567'
    },
    items: [
      {
        name: 'Skin Brightening Cream',
        quantity: 1,
        price: 6800,
        selectedVariant: '50ml',
        sku: 'SBC-01'
      },
      {
        name: 'Gentle Purifying Face Wash',
        quantity: 1,
        price: 1600,
        selectedVariant: null,
        sku: 'PFW-01'
      }
    ],
    trackingNumber: 'LEVA-TRAK-987654'
  };

  const mockUser = {
    name: 'Ayesha Khan',
    email: 'ayesha.test@example.com'
  };

  const templates = [
    {
      name: 'Order Confirmation Email',
      content: mailer.buildOrderConfirmationEmail(mockOrder, { isNewAccount: true, rawPassword: 'TemporaryPass123!' })
    },
    {
      name: 'Admin New Order Email',
      content: mailer.buildAdminNewOrderEmail(mockOrder)
    },
    {
      name: 'Order Status Update Email',
      content: mailer.buildOrderStatusEmail(mockOrder)
    },
    {
      name: 'Order Delivered Email',
      content: mailer.buildOrderDeliveredEmail(mockOrder)
    },
    {
      name: 'Password Reset Email',
      content: mailer.buildPasswordResetEmail(mockUser, '982341')
    },
    {
      name: 'Account Activation Email',
      content: mailer.buildAccountActivationEmail(mockUser, 'activate-token-xyz')
    },
    {
      name: 'Contact Enquiry Confirmation Email',
      content: mailer.buildContactConfirmationEmail('enquirer@example.com', 'Hamza Tariq')
    }
  ];

  for (const { name, content } of templates) {
    console.log(`\nTesting [${name}]:`);
    assert(content.subject && content.subject.length > 5, `Subject must not be empty for ${name}`);
    assert(content.text && content.text.length > 20, `Plain text must not be empty for ${name}`);
    assert(content.html && content.html.length > 50, `HTML must not be empty for ${name}`);

    // Verify logo image element
    assert(content.html.includes('<img '), `HTML must contain an <img> element for ${name}`);
    assert(content.html.includes(logoUrl), `HTML must contain the official logo URL for ${name}`);
    assert(content.html.includes('alt="LEVA"'), `HTML must have descriptive alt="LEVA" for ${name}`);
    assert(content.html.includes('width="100"'), `HTML must set explicit email-safe width="100" for ${name}`);
    assert(content.html.includes('role="presentation"'), `HTML must use presentation tables for ${name}`);
    assert(content.html.includes('Customer Support:'), `HTML must include standard support footer for ${name}`);

    console.log(`  ✓ Subject: "${content.subject}"`);
    console.log(`  ✓ HTML length: ${content.html.length} bytes`);
    console.log(`  ✓ Plain text length: ${content.text.length} bytes`);
    console.log(`  ✓ Brand logo <img> tag verified with src, alt, explicit dimensions and email-safe presentation table.`);
  }

  console.log('\n======================================================');
  console.log('ALL 7 TRANSACTIONAL EMAIL TEMPLATES VERIFIED WITH LEVA BRAND LOGO!');
  console.log('======================================================');
}

runEmailTests().catch(err => {
  console.error('Email verification failed:', err);
  process.exit(1);
});
