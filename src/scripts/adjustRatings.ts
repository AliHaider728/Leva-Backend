import { pool } from '../mysql-lib/db.js';

async function main() {
  const conn = await pool.getConnection();
  try {
    // 1. LEVA Cream -> Set all reviews to rating 5 so average is 5.0
    await conn.execute(
      "UPDATE reviews SET rating = 5 WHERE productId = '7f43d8ce-d716-481f-8a51-fcc7170d0e55'"
    );
    await conn.execute(
      "UPDATE products SET rating = 5.00, updatedAt = NOW() WHERE id = '7f43d8ce-d716-481f-8a51-fcc7170d0e55'"
    );

    // 2. LEVA Tinted Sunblock -> 23 reviews with 5, 2 reviews with 4 so average is 4.92 -> 4.9
    await conn.execute(
      "UPDATE reviews SET rating = 5 WHERE productId = 'e58decf4-e585-4c81-a9ee-a61149350574'"
    );
    await conn.execute(
      "UPDATE reviews SET rating = 4 WHERE productId = 'e58decf4-e585-4c81-a9ee-a61149350574' AND reviewerName IN ('Sadia Noor', 'Bushra Jamil')"
    );
    await conn.execute(
      "UPDATE products SET rating = 4.90, updatedAt = NOW() WHERE id = 'e58decf4-e585-4c81-a9ee-a61149350574'"
    );

    // 3. LEVA Face Wash -> 24 reviews with 5, 6 reviews with 4 so average is 4.80 -> 4.8
    await conn.execute(
      "UPDATE reviews SET rating = 5 WHERE productId = '5ee90b2d-26a8-4891-99ad-476f475a7f0e'"
    );
    await conn.execute(
      "UPDATE reviews SET rating = 4 WHERE productId = '5ee90b2d-26a8-4891-99ad-476f475a7f0e' AND reviewerName IN ('Aiman Raza', 'Fiza Rehman', 'Ahsan Butt', 'Waleed Khan', 'Zubair Hassan', 'Sameer Abbas')"
    );
    await conn.execute(
      "UPDATE products SET rating = 4.80, updatedAt = NOW() WHERE id = '5ee90b2d-26a8-4891-99ad-476f475a7f0e'"
    );

    // Check results
    const [rows] = await conn.execute(
      `SELECT p.name, p.slug, p.rating, p.reviewCount, ROUND(AVG(r.rating), 2) as actualAvg
       FROM products p
       LEFT JOIN reviews r ON p.id = r.productId AND r.status = 'approved'
       GROUP BY p.id`
    );
    console.log('Updated product ratings:', rows);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Failed to adjust ratings:', err);
  process.exit(1);
});
