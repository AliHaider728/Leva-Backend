import { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';
import { getAdminModules, AdminModule } from '../config/adminModules.js';
export function requestAdminModule(req:AuthRequest):AdminModule|undefined {
 const path=(req.baseUrl+req.path).replace(/^\/api\//,'');
 if(path.startsWith('admin/features')) return;
 if(path.startsWith('admin/dashboard')) return;
 if(path.startsWith('admin/customers')) return 'customers';
 if(path.startsWith('admin/reports')) return 'reports';
 if(path.startsWith('admin/best-sellers')) return 'bestSellers';
 if(path.startsWith('products')) return 'products';
 if(path.startsWith('categories')) return 'categories';
 if(path.startsWith('global-attributes')) return 'attributes';
 if(path.startsWith('orders')) return 'orders';
 if(path==='auth/users') return 'customers';
 if(path.startsWith('reviews')) return 'reviews';
 if(path.startsWith('audio-reviews')) return 'audioReviews';
 if(path.startsWith('contact')) return 'contact';
 if(path.startsWith('bundles')) return 'bundles';
 if(path.startsWith('coupons')) return 'coupons';
 if(path.startsWith('settings/routine')) return 'routineDiscounts';
 if(path.startsWith('settings')&&req.query.appearance==='true') return 'appearance';
 if(path.startsWith('settings')&&req.body&&(req.body.storefrontNavigation||req.body.homepageSections)) return 'appearance';
 if(path.startsWith('settings')) return 'settings';
}
export async function enforceAdminModule(req:AuthRequest,res:Response,next:NextFunction) { const module=requestAdminModule(req); if(!module)return next();try { if(!(await getAdminModules())[module])return res.status(404).json({error:'This admin module is disabled.'});next(); }catch{res.status(503).json({error:'Admin feature storage migration is required.'});} }
