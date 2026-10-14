import adminRoutes from './mysql-routes/admin.js';
import { authenticateToken as adminAuthenticate, requireAdmin as adminAuthorize, authenticateIfPresent as optionalAdminAuthenticate } from './middleware/auth.js';
import helmet from 'helmet';
import { limiter,accountLimiter,wrapAsyncRouter,errorHandler } from './middleware/security.js';
import featureRoutes from './mysql-routes/features.js';
import { requireFeature } from './middleware/features.js';
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors, { CorsOptions } from 'cors';

import uploadRoutes from './mysql-routes/upload.js';
import { pool } from './mysql-lib/db.js';

import mysqlContactRoutes from './mysql-routes/contact.js';
import mysqlCouponRoutes from './mysql-routes/coupons.js';
import mysqlSettingsRoutes from './mysql-routes/settings.js';
import mysqlGlobalAttributeRoutes from './mysql-routes/globalAttributes.js';
import mysqlCategoryRoutes from './mysql-routes/categories.js';
import mysqlAuthRoutes from './mysql-routes/auth.js';
import mysqlReviewRoutes from './mysql-routes/reviews.js';
import mysqlOrderRoutes from './mysql-routes/orders.js';
import mysqlProductRoutes from './mysql-routes/products.js';
import bundlesRouter from './mysql-routes/bundles.js';
import audioReviewsRouter from './mysql-routes/audioReviews.js';

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const limiterForOrders=limiter(20),limiterForReviews=limiter(10),limiterForContact=limiter(5),limiterForCoupons=limiter(30);
const app = express();
app.disable('x-powered-by');
const proxyHops=Number(process.env.TRUST_PROXY_HOPS||0);if(Number.isInteger(proxyHops)&&proxyHops>0)app.set('trust proxy',proxyHops);
app.use(helmet());


const configuredFrontendUrl = process.env.FRONTEND_URL?.trim();
const allowedOrigins = [...new Set([
  ...(process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean),
  ...(configuredFrontendUrl ? [configuredFrontendUrl] : []),
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000','http://127.0.0.1:3000'])
])];

const corsOptions: CorsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Leva-Storefront'],
  optionsSuccessStatus: 204
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&!allowedOrigins.includes(req.headers.origin))return res.status(403).json({error:'This origin is not permitted.'});next();});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  try {
    await pool.execute('SELECT 1');
    dbStatus = 'connected (MySQL)';
  } catch {
    dbStatus = 'error';
  }

  res.json({
    status: 'online',
    message: 'LEVA API Backend is running (MySQL)',
    database: dbStatus,
    endpoints: [
      '/api/products',
      '/api/categories',
      '/api/global-attributes',
      '/api/orders',
      '/api/reviews',
      '/api/auth',
      '/api/settings',
      '/api/coupons',
      '/api/contact'
    ]
  });
});

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await pool.execute('SELECT 1');

    res.json({
      status: 'ok',
      dbConnected: true
    });
  } catch (err: any) {
    console.error('MySQL health check failed:', err);
    res.status(503).json({
      status: 'error',
      dbConnected: false,
      error: 'Database connection unavailable'
    });
  }
});

for(const router of [adminRoutes,featureRoutes,mysqlContactRoutes,mysqlCouponRoutes,mysqlSettingsRoutes,mysqlGlobalAttributeRoutes,mysqlCategoryRoutes,mysqlAuthRoutes,mysqlReviewRoutes,mysqlOrderRoutes,mysqlProductRoutes,bundlesRouter,audioReviewsRouter,uploadRoutes])wrapAsyncRouter(router);
app.use('/api/orders', (req,res,next)=>req.method==='POST'?limiterForOrders(req,res,next):next());
app.use('/api/reviews', (req,res,next)=>req.method==='POST'?limiterForReviews(req,res,next):next());
app.use('/api/contact', (req,res,next)=>req.method==='POST'?limiterForContact(req,res,next):next());
app.post('/api/coupons/validate',limiterForCoupons);
app.use('/api', (req:any,res,next)=>{
 if(req.headers['x-leva-admin-request']==='1')return adminAuthenticate(req,res,()=>adminAuthorize(req,res,next));
 optionalAdminAuthenticate(req,res,()=>{const isAdmin=['admin','super_admin'].includes(req.user?.role);const publicRead=['GET','HEAD'].includes(req.method)&&req.headers['x-leva-storefront']==='1'&&!req.path.includes('/admin')&&req.query.all!=='true'&&/^\/(products|bundles|settings|categories|global-attributes|reviews\/product|audio-reviews)(\/|$)/.test(req.path);const publicWrite=req.method==='POST'&&['/orders','/contact','/reviews','/coupons/validate','/auth/login','/auth/logout','/auth/register','/auth/forgot-password','/auth/reset-password'].includes(req.path);if(isAdmin&&!publicWrite&&!publicRead)return adminAuthorize(req,res,next);next();});
});
app.use('/api/admin',adminRoutes);
app.use('/api/features',featureRoutes);
app.use('/api/contact',requireFeature('contact'), mysqlContactRoutes);
app.use('/api/coupons',requireFeature('coupons'), mysqlCouponRoutes);
app.use('/api/settings', mysqlSettingsRoutes);
app.use('/api/global-attributes',requireFeature('variants'), mysqlGlobalAttributeRoutes);
app.use('/api/categories',requireFeature('categories'), mysqlCategoryRoutes);
app.use('/api/auth', mysqlAuthRoutes);
app.use('/api/reviews',requireFeature('reviews'), mysqlReviewRoutes);
app.use('/api/orders', mysqlOrderRoutes);
app.use('/api/products', mysqlProductRoutes);
app.use('/api/bundles',requireFeature('bundles'), bundlesRouter);
app.use('/api/audio-reviews',requireFeature('audioReviews'), audioReviewsRouter);
app.use('/api/upload', uploadRoutes);

app.use((_req,res)=>res.status(404).json({error:'Endpoint not found.'}));
app.use(errorHandler);
export default app;

if (typeof module !== 'undefined') {
  module.exports = app;
}

const isPassengerRuntime = Boolean(
  process.env.PASSENGER_APP_ENV || process.env.PASSENGER_BASE_URI
);

if (
  typeof require !== 'undefined' &&
  require.main === module &&
  !isPassengerRuntime
) {
  const port = Number.parseInt(process.env.PORT ?? '5000', 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const isManagedRuntime =
    process.env.NODE_ENV === 'production' || Boolean(process.env.PASSENGER_BASE_URI);

  async function checkPortAndStart() {
    if (!isManagedRuntime) {
      try {
        const { stdout } = await execAsync(
          process.platform === 'win32'
            ? `netstat -ano | findstr :${port} | findstr LISTENING`
            : `lsof -i :${port} | grep LISTEN`
        );

        if (stdout.trim()) {
          const match = process.platform === 'win32'
            ? stdout.trim().match(/LISTENING\s+(\d+)/i)
            : stdout.trim().match(/\s+(\d+)\s+/);

          const pid = match ? match[1] : 'Unknown';
          console.error(`\n[ERROR] Port ${port} is already in use.`);
          console.error(`The backend may already be running on PID ${pid}.`);
          if (process.platform === 'win32') {
            console.error(`Run this command to kill it: taskkill /PID ${pid} /F\n`);
          } else {
            console.error(`Run this command to kill it: kill -9 ${pid}\n`);
          }
          process.exit(1);
        }
      } catch (err) {
      }
    }

    const server = app.listen(port, async () => {
      try {
        await pool.execute('SELECT 1');

        const [[{ count: products }]] = await pool.execute<any>('SELECT COUNT(*) as count FROM products');
        const [[{ count: reviews }]] = await pool.execute<any>('SELECT COUNT(*) as count FROM reviews');
        const [[{ count: orders }]] = await pool.execute<any>('SELECT COUNT(*) as count FROM orders');
        const [[{ count: categories }]] = await pool.execute<any>('SELECT COUNT(*) as count FROM categories');
        const [[{ count: coupons }]] = await pool.execute<any>('SELECT COUNT(*) as count FROM coupons');
        const [[{ count: users }]] = await pool.execute<any>('SELECT COUNT(*) as count FROM users');

        console.log('\n=========================================');
        console.log('  LEVA Backend API (MySQL)');
        console.log(`  Status: RUNNING on http://localhost:${port}`);
        console.log('  Database: CONNECTED (MySQL)');
        console.log(`  Products: ${products} | Reviews: ${reviews} | Orders: ${orders}`);
        console.log(`  Categories: ${categories} | Coupons: ${coupons} | Users: ${users}`);
        console.log('=========================================\n');
      } catch (err) {
        console.log('\n=========================================');
        console.log('  LEVA Backend API (MySQL)');
        console.log(`  Status: RUNNING on http://localhost:${port}`);
        console.log('  Database: DISCONNECTED (MySQL Error)');
        console.log('=========================================\n');
      }
    });

    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`\n[ERROR] Port ${port} is already in use by another process.`);
        console.error(`Please kill the process to restart the backend.`);
        if (process.platform === 'win32') {
          console.error(`Run this command to find the PID:  netstat -ano | findstr :${port}`);
          console.error(`Then kill it:                      taskkill /PID <pid> /F\n`);
        } else {
          console.error(`Run this command to find the PID:  lsof -i :${port}`);
          console.error(`Then kill it:                      kill -9 <pid>\n`);
        }
        process.exit(1);
      } else {
        console.error('Server error:', error);
        process.exit(1);
      }
    });
  }

  checkPortAndStart();
}
