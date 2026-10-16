require('dotenv').config();
const assert = require('assert');
const { pool } = require('../dist/mysql-lib/db.js');
const jwt = require('jsonwebtoken');

async function testReviewWorkflow() {
  console.log('--- Testing Review Submission & Approval Workflow ---');

  // 1. Get a live product
  const [products] = await pool.execute('SELECT id, name, slug FROM products WHERE isVisible = 1 AND status != "draft" LIMIT 1');
  const product = products[0];
  assert(product, 'Must have at least one active product');
  console.log('Using product:', product.name, product.id);

  // 2. Submit a public review via local API or direct test
  const reviewId = 'test-rev-' + Date.now();
  const testName = 'Review Test ' + Date.now();
  const testContent = 'This is a test review for verifying admin approval workflow.';
  
  // Test POST /api/reviews directly via fetch to local backend
  const submitRes = await fetch('http://localhost:5001/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: product.id,
      productName: product.name,
      reviewerName: testName,
      reviewerEmail: 'tester@example.com',
      rating: 5,
      title: 'Amazing Product',
      content: testContent
    })
  });

  const submitJson = await submitRes.json();
  console.log('Submit response status:', submitRes.status, submitJson.message);
  assert.equal(submitRes.status, 201, 'Review submission should return 201');
  assert.equal(submitJson.review.status, 'pending', 'Review status should be pending');
  const createdReviewId = submitJson.review.id;

  // 3. Admin token
  const [adminUsers] = await pool.execute('SELECT id, email, role FROM users WHERE role IN ("admin", "super_admin") LIMIT 1');
  const adminUser = adminUsers[0];
  assert(adminUser, 'Must have at least one admin user in DB');
  const adminToken = jwt.sign({ userId: adminUser.id, email: adminUser.email, role: adminUser.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // 4. Fetch admin reviews
  const adminListRes = await fetch('http://localhost:5001/api/reviews/admin', {
    headers: {
      'Cookie': `leva_admin_token=${adminToken}`,
      'X-Leva-Admin-Request': '1'
    }
  });
  const adminListJson = await adminListRes.json();
  console.log('Admin list status:', adminListRes.status, 'Total reviews:', adminListJson.total, 'Pending:', adminListJson.counts.pending);
  assert.equal(adminListRes.status, 200, 'Admin reviews list should return 200');
  const foundInAdmin = adminListJson.reviews.find(r => r.id === createdReviewId);
  assert(foundInAdmin, 'Submitted review must appear in admin list');
  assert.equal(foundInAdmin.status, 'pending', 'Status in admin must be pending');

  // 5. Approve the review
  const approveRes = await fetch(`http://localhost:5001/api/reviews/${createdReviewId}/approve`, {
    method: 'PUT',
    headers: {
      'Cookie': `leva_admin_token=${adminToken}`,
      'X-Leva-Admin-Request': '1'
    }
  });
  const approveJson = await approveRes.json();
  console.log('Approve response status:', approveRes.status, 'Approved status:', approveJson.status);
  assert.equal(approveRes.status, 200, 'Approval should return 200');
  assert.equal(approveJson.status, 'approved', 'Review status should now be approved');

  // 6. Check public product reviews
  const publicRes = await fetch(`http://localhost:5001/api/reviews/product/${product.id}`);
  const publicJson = await publicRes.json();
  console.log('Public product reviews count:', publicJson.length);
  const foundInPublic = publicJson.find(r => r.id === createdReviewId);
  assert(foundInPublic, 'Approved review must appear in public reviews');

  // 7. Cleanup test review
  await pool.execute('DELETE FROM reviews WHERE id = ?', [createdReviewId]);
  console.log('Cleaned up test review.');

  await pool.end();
  console.log('PASS: All review workflow steps verified successfully!');
}

testReviewWorkflow().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
