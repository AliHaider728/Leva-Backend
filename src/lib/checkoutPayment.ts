import { ClientError } from './httpError.js';
export function checkoutPayment(value: unknown) { if (value === undefined)
    return 'COD'; if (typeof value !== 'string' || value.trim().toUpperCase() !== 'COD')
    throw new ClientError('Only cash on delivery (COD) is accepted.'); return 'COD'; }
