import { pool } from '../mysql-lib/db.js';
export const adminModuleDefaults = { products:true,categories:true,attributes:true,orders:true,customers:true,reviews:true,audioReviews:true,contact:true,bundles:true,coupons:true,reports:true,routineDiscounts:true,bestSellers:true,appearance:true,settings:true };
export type AdminModule = keyof typeof adminModuleDefaults;
export type AdminModules = Record<AdminModule,boolean>;
export function mergeAdminModules(value: unknown): AdminModules { const flags={...adminModuleDefaults}; const parsed=typeof value==='string'?JSON.parse(value):value; if(parsed&&typeof parsed==='object') for(const key of Object.keys(flags) as AdminModule[]) if(typeof (parsed as any)[key]==='boolean') flags[key]=(parsed as any)[key]; return flags; }
export async function getAdminModules() { const [rows]:any=await pool.execute('SELECT adminFeatures FROM settings LIMIT 1'); return mergeAdminModules(rows[0]?.adminFeatures); }
