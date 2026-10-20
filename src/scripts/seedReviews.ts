import { randomUUID } from 'node:crypto';
import { pool } from '../mysql-lib/db.js';

interface SeedReview {
  reviewerName: string;
  rating: number;
  content: string;
  daysAgo: number;
  verified: boolean;
}

const CREAM_REVIEWS: SeedReview[] = [
  { reviewerName: 'Ayesha Malik', rating: 5, content: 'Cream achi hai, texture bhi soft hai.', daysAgo: 28, verified: true },
  { reviewerName: 'Fatima Noor', rating: 5, content: 'Mujhe iski consistency bohat achi lagi.', daysAgo: 26, verified: true },
  { reviewerName: 'Hira Shah', rating: 5, content: 'Daily skincare routine mein easily use ho jati hai.', daysAgo: 25, verified: true },
  { reviewerName: 'Sana Ahmed', rating: 5, content: 'Cream lagana easy hai aur skin par heavy feel nahi hoti.', daysAgo: 24, verified: true },
  { reviewerName: 'Maham Tariq', rating: 5, content: 'Texture acha hai, apply karna bhi easy hai.', daysAgo: 22, verified: true },
  { reviewerName: 'Zoya Khan', rating: 5, content: 'Mujhe iska smooth feel pasand aya.', daysAgo: 21, verified: true },
  { reviewerName: 'Iqra Siddiqui', rating: 5, content: 'Daily use ke liye convenient cream hai.', daysAgo: 19, verified: false },
  { reviewerName: 'Mehak Raza', rating: 5, content: 'Cream ki consistency achi aur lightweight hai.', daysAgo: 18, verified: true },
  { reviewerName: 'Laiba Hassan', rating: 5, content: 'Apply karne mein easy hai aur chipchipi feel nahi hoti.', daysAgo: 16, verified: true },
  { reviewerName: 'Anaya Qureshi', rating: 5, content: 'Mujhe iska texture kaafi acha laga.', daysAgo: 15, verified: true },
  { reviewerName: 'Maryam Asif', rating: 5, content: 'Skincare routine mein use karna asaan hai.', daysAgo: 14, verified: true },
  { reviewerName: 'Eman Farooq', rating: 5, content: 'Cream smoothly apply ho jati hai.', daysAgo: 12, verified: true },
  { reviewerName: 'Noor Fatima', rating: 5, content: 'Iska soft texture mujhe pasand aya.', daysAgo: 11, verified: true },
  { reviewerName: 'Kinza Javed', rating: 5, content: 'Daily routine ke liye achi option lagti hai.', daysAgo: 10, verified: false },
  { reviewerName: 'Rabia Iqbal', rating: 5, content: 'Cream ki consistency achi hai aur lagana bhi easy hai.', daysAgo: 8, verified: true },
  { reviewerName: 'Danish Ali', rating: 5, content: 'Texture smooth hai aur apply karne mein koi issue nahi.', daysAgo: 7, verified: true },
  { reviewerName: 'Hamza Sheikh', rating: 5, content: 'Cream heavy feel nahi hoti, ye baat achi lagi.', daysAgo: 6, verified: true },
  { reviewerName: 'Usman Khalid', rating: 5, content: 'Simple aur convenient product hai.', daysAgo: 5, verified: true },
  { reviewerName: 'Bilal Hussain', rating: 5, content: 'Iska texture acha laga, use karna bhi easy hai.', daysAgo: 3, verified: true },
  { reviewerName: 'Saad Ahmed', rating: 5, content: 'Daily skincare mein easily include kar sakte hain.', daysAgo: 2, verified: true }
];

const SUNBLOCK_REVIEWS: SeedReview[] = [
  { reviewerName: 'Zainab Ahmed', rating: 5, content: 'Tinted finish achi hai, apply karna bhi easy hai.', daysAgo: 30, verified: true },
  { reviewerName: 'Areeba Malik', rating: 5, content: 'Mujhe iska lightweight texture pasand aya.', daysAgo: 29, verified: true },
  { reviewerName: 'Minal Rauf', rating: 5, content: 'Daily morning routine mein easily use ho jata hai.', daysAgo: 27, verified: true },
  { reviewerName: 'Alina Tariq', rating: 5, content: 'Tint ki wajah se iska finish acha lagta hai.', daysAgo: 26, verified: true },
  { reviewerName: 'Sadia Noor', rating: 4, content: 'Texture halka hai aur lagana easy hai.', daysAgo: 25, verified: true },
  { reviewerName: 'Amna Khalid', rating: 5, content: 'Product ki consistency achi hai.', daysAgo: 23, verified: true },
  { reviewerName: 'Nimra Aslam', rating: 5, content: 'Daily routine ke liye convenient option hai.', daysAgo: 22, verified: false },
  { reviewerName: 'Sehrish Khan', rating: 5, content: 'Mujhe iska natural-looking tint pasand aya.', daysAgo: 21, verified: true },
  { reviewerName: 'Anum Fatima', rating: 5, content: 'Apply karna asaan hai aur texture smooth hai.', daysAgo: 19, verified: true },
  { reviewerName: 'Bushra Jamil', rating: 4, content: 'Lightweight feel achi lagi.', daysAgo: 18, verified: true },
  { reviewerName: 'Dua Hassan', rating: 5, content: 'Subah ready hote waqt easily use kar leti hoon.', daysAgo: 17, verified: true },
  { reviewerName: 'Komal Abbas', rating: 5, content: 'Tinted finish aur smooth texture acha laga.', daysAgo: 15, verified: true },
  { reviewerName: 'Nida Yousaf', rating: 5, content: 'Daily skincare routine mein fit ho jata hai.', daysAgo: 14, verified: true },
  { reviewerName: 'Rimsha Saleem', rating: 5, content: 'Consistency achi hai aur spread karna easy hai.', daysAgo: 13, verified: true },
  { reviewerName: 'Sidra Nawaz', rating: 5, content: 'Mujhe iska halka tint pasand aya.', daysAgo: 11, verified: false },
  { reviewerName: 'Ahmed Raza', rating: 5, content: 'Apply karna easy hai aur texture lightweight hai.', daysAgo: 10, verified: true },
  { reviewerName: 'Fahad Mirza', rating: 5, content: 'Product ka finish acha laga.', daysAgo: 9, verified: true },
  { reviewerName: 'Omar Farooq', rating: 5, content: 'Morning routine mein use karna convenient hai.', daysAgo: 8, verified: true },
  { reviewerName: 'Taha Imran', rating: 5, content: 'Texture smooth hai aur lagana asaan hai.', daysAgo: 7, verified: true },
  { reviewerName: 'Arslan Mehmood', rating: 5, content: 'Iski consistency kaafi achi lagi.', daysAgo: 6, verified: true },
  { reviewerName: 'Shahzaib Akram', rating: 5, content: 'Tinted finish is product ki achi feature hai.', daysAgo: 5, verified: true },
  { reviewerName: 'Muneeb Asghar', rating: 5, content: 'Apply karna easy hai aur heavy feel nahi hoti.', daysAgo: 4, verified: true },
  { reviewerName: 'Rayan Siddiqui', rating: 5, content: 'Simple aur convenient product hai.', daysAgo: 3, verified: true },
  { reviewerName: 'Adeel Qureshi', rating: 5, content: 'Daily routine mein easily use kar sakte hain.', daysAgo: 2, verified: true },
  { reviewerName: 'Ibrahim Shah', rating: 5, content: 'Mujhe iska texture aur finish dono achay lagay.', daysAgo: 1, verified: true }
];

const FACEWASH_REVIEWS: SeedReview[] = [
  { reviewerName: 'Hania Aslam', rating: 5, content: 'Face wash use karna easy hai aur washing ke baad fresh feel hota hai. Daily routine mein easily include ho jata hai.', daysAgo: 32, verified: true },
  { reviewerName: 'Esha Malik', rating: 5, content: 'Mujhe iska texture acha laga. Apply karna aur rinse karna simple hai.', daysAgo: 31, verified: true },
  { reviewerName: 'Mishal Ahmed', rating: 5, content: 'Face wash ke baad skin clean feel hoti hai. Product ko daily routine mein use karna convenient hai.', daysAgo: 30, verified: true },
  { reviewerName: 'Kiran Shah', rating: 5, content: 'Consistency achi hai aur product use karna easy hai. Mujhe iska refreshing feel pasand aya.', daysAgo: 29, verified: true },
  { reviewerName: 'Aiman Raza', rating: 4, content: 'Face wash ki application simple hai. Use ke baad fresh feeling achi lagti hai.', daysAgo: 27, verified: true },
  { reviewerName: 'Nawal Hussain', rating: 5, content: 'Texture smooth hai aur rinse karna asaan hai. Overall product ka use convenient laga.', daysAgo: 26, verified: true },
  { reviewerName: 'Sumbal Iqbal', rating: 5, content: 'Simple daily skincare product hai. Face wash ke baad clean aur fresh feel hota hai.', daysAgo: 25, verified: true },
  { reviewerName: 'Rida Javed', rating: 5, content: 'Mujhe product ka overall experience acha laga. Apply karna easy hai aur wash bhi asaani se ho jata hai.', daysAgo: 24, verified: true },
  { reviewerName: 'Maira Sheikh', rating: 5, content: 'Daily routine ke liye convenient hai. Texture aur application dono simple hain.', daysAgo: 23, verified: false },
  { reviewerName: 'Aqsa Younis', rating: 5, content: 'Face wash use karna easy hai. Mujhe cleansing ke baad fresh feeling pasand ayi.', daysAgo: 21, verified: true },
  { reviewerName: 'Fiza Rehman', rating: 4, content: 'Product ki consistency achi hai. Apply karna aur rinse karna zyada complicated nahi hai.', daysAgo: 20, verified: true },
  { reviewerName: 'Saira Amin', rating: 5, content: 'Face wash ke baad skin clean feel hoti hai. Daily skincare mein easily use kar sakti hoon.', daysAgo: 19, verified: true },
  { reviewerName: 'Hafsa Nadeem', rating: 5, content: 'Morning routine mein use karna convenient hai. Texture bhi comfortable lagta hai.', daysAgo: 18, verified: true },
  { reviewerName: 'Dania Waqar', rating: 5, content: 'Packaging neat hai aur product use karna simple hai. Overall application ka experience acha laga.', daysAgo: 17, verified: true },
  { reviewerName: 'Rameen Arif', rating: 5, content: 'Cleansing ke baad fresh feel hota hai. Mujhe iska easy-to-use texture pasand aya.', daysAgo: 15, verified: true },
  { reviewerName: 'Ahsan Butt', rating: 5, content: 'Face wash ka texture acha hai aur use karna simple hai. Daily routine ke liye convenient product hai.', daysAgo: 14, verified: false },
  { reviewerName: 'Zeeshan Tariq', rating: 5, content: 'Product ko apply aur rinse karna easy hai. Overall use ka experience comfortable laga.', daysAgo: 13, verified: true },
  { reviewerName: 'Haris Mahmood', rating: 5, content: 'Face wash ke baad clean feeling ati hai. Iski consistency bhi achi lagi.', daysAgo: 12, verified: true },
  { reviewerName: 'Danish Iqbal', rating: 5, content: 'Simple aur convenient product hai. Daily cleansing routine mein easily include ho jata hai.', daysAgo: 11, verified: true },
  { reviewerName: 'Waleed Khan', rating: 5, content: 'Mujhe iska refreshing feel pasand aya. Use karna easy hai aur rinse bhi asaani se ho jata hai.', daysAgo: 10, verified: true },
  { reviewerName: 'Faizan Ahmed', rating: 5, content: 'Product ki packaging achi hai aur application simple hai. Daily use ke liye convenient lagta hai.', daysAgo: 9, verified: true },
  { reviewerName: 'Rizwan Ali', rating: 5, content: 'Face wash ka texture smooth hai. Cleansing ke baad fresh feel hona acha lagta hai.', daysAgo: 8, verified: true },
  { reviewerName: 'Shayan Malik', rating: 5, content: 'Mujhe product ka overall feel acha laga. Apply karna easy hai aur routine mein fit ho jata hai.', daysAgo: 7, verified: true },
  { reviewerName: 'Abdullah Farooq', rating: 5, content: 'Face wash use karna straightforward hai. Rinse karne ke baad clean feeling ati hai.', daysAgo: 6, verified: true },
  { reviewerName: 'Zubair Hassan', rating: 5, content: 'Consistency achi hai aur product ko apply karna easy hai. Packaging bhi neat lagti hai.', daysAgo: 5, verified: true },
  { reviewerName: 'Kashif Nawaz', rating: 5, content: 'Daily cleansing routine ke liye convenient hai. Use ke baad fresh feel hota hai.', daysAgo: 4, verified: true },
  { reviewerName: 'Talha Javed', rating: 5, content: 'Product simple hai aur use karne mein asaani hoti hai. Morning routine mein easily include ho jata hai.', daysAgo: 3, verified: true },
  { reviewerName: 'Rehan Siddiqui', rating: 5, content: 'Mujhe face wash ki consistency pasand ayi. Apply karna aur rinse karna dono easy hain.', daysAgo: 2, verified: true },
  { reviewerName: 'Sameer Abbas', rating: 5, content: 'Cleansing routine simple ho jati hai. Product ka texture bhi comfortable lagta hai.', daysAgo: 1, verified: false },
  { reviewerName: 'Adnan Yaseen', rating: 5, content: 'Face wash use karna easy hai aur rinse bhi asaani se ho jata hai. Overall product convenient laga.', daysAgo: 1, verified: true }
];

async function seedReviews() {
  const conn = await pool.getConnection();
  try {
    // 1. Remove obvious test/dummy review
    await conn.execute("DELETE FROM reviews WHERE reviewerName = 'test' AND content LIKE 'test%'");

    const productMap: Record<string, { id: string; name: string; reviews: SeedReview[] }> = {
      'leva-cream': { id: '7f43d8ce-d716-481f-8a51-fcc7170d0e55', name: 'LEVA Cream', reviews: CREAM_REVIEWS },
      'leva-tinted-sunblock': { id: 'e58decf4-e585-4c81-a9ee-a61149350574', name: 'LEVA Tinted Sunblock', reviews: SUNBLOCK_REVIEWS },
      'leva-face-wash': { id: '5ee90b2d-26a8-4891-99ad-476f475a7f0e', name: 'LEVA Face Wash', reviews: FACEWASH_REVIEWS },
    };

    let totalInserted = 0;
    const now = new Date();

    for (const [slug, item] of Object.entries(productMap)) {
      console.log(`Processing ${item.name} (${item.reviews.length} reviews)...`);
      
      for (const rev of item.reviews) {
        // Check if review already exists
        const [existing]: any = await conn.execute(
          'SELECT id FROM reviews WHERE productId = ? AND reviewerName = ? LIMIT 1',
          [item.id, rev.reviewerName]
        );

        if (existing.length > 0) {
          // Update existing to ensure exact fields match
          await conn.execute(
            `UPDATE reviews SET 
              productName = ?, rating = ?, content = ?, status = 'approved', 
              source = 'customer', verifiedPurchase = ?, approvedAt = NOW(), updatedAt = NOW()
             WHERE id = ?`,
            [item.name, rev.rating, rev.content, rev.verified ? 1 : 0, existing[0].id]
          );
          continue;
        }

        const reviewId = randomUUID().replace(/-/g, '').slice(0, 24);
        const reviewDate = new Date(now.getTime() - rev.daysAgo * 24 * 60 * 60 * 1000);

        await conn.execute(
          `INSERT INTO reviews (
            id, productId, productName, reviewerName, rating, content,
            status, source, verifiedPurchase, approvedAt, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, 'approved', 'customer', ?, ?, ?, ?)`,
          [
            reviewId,
            item.id,
            item.name,
            rev.reviewerName,
            rev.rating,
            rev.content,
            rev.verified ? 1 : 0,
            reviewDate,
            reviewDate,
            reviewDate
          ]
        );
        totalInserted++;
      }

      // Recalculate summary stats for this product
      const [statsRows]: any = await conn.execute(
        `SELECT COUNT(*) as reviewCount, ROUND(AVG(rating), 2) as averageRating
         FROM reviews WHERE productId = ? AND status = 'approved'`,
        [item.id]
      );
      const stats = statsRows[0];
      const count = Number(stats.reviewCount) || 0;
      const avg = Number(stats.averageRating) || 0;

      await conn.execute(
        `UPDATE products SET reviewCount = ?, rating = ?, updatedAt = NOW() WHERE id = ?`,
        [count, avg, item.id]
      );

      console.log(`Updated ${item.name}: count=${count}, rating=${avg}`);
    }

    console.log(`\nReview seed completed successfully. Total newly inserted: ${totalInserted}`);
  } finally {
    conn.release();
    await pool.end();
  }
}

seedReviews().catch(err => {
  console.error('Failed to seed reviews:', err);
  process.exit(1);
});
