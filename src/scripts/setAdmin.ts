/** Explicit future account setup; no credentials are embedded or saved to files. */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pool } from '../mysql-lib/db.js';
async function main() { let muted = false; const output = new Writable({ write(chunk, _encoding, done) { if (!muted)
        process.stdout.write(chunk); done(); } }); const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY }); try {
    const email = (process.env.ADMIN_EMAIL || await rl.question('Admin email: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error('Invalid email');
    let value = process.env.ADMIN_PASSWORD;
    if (!value) {
        if (!process.stdin.isTTY)
            throw new Error('Use an interactive terminal for password entry.');
        process.stdout.write('Admin password (hidden): ');
        muted = true;
        value = await rl.question('');
        muted = false;
        process.stdout.write('\n');
    }
    if (value.length < 8 || Buffer.byteLength(value, 'utf8') > 72)
        throw new Error('Password must contain at least 8 characters and at most 72 bytes.');
    const hash = await bcrypt.hash(value, 12);

    const [rows]: any = await pool.execute('SELECT id,role FROM users WHERE email=?', [email]);
    if (rows[0])
        await pool.execute('UPDATE users SET passwordHash=?,role=?,resetPasswordToken=NULL,resetPasswordExpires=NULL,updatedAt=NOW() WHERE id=?', [hash, 'super_admin', rows[0].id]);
    else
        await pool.execute('INSERT INTO users (id,name,email,passwordHash,role,wishlist,createdAt,updatedAt) VALUES (?,?,?,?,?,?,NOW(),NOW())', [randomUUID(), 'LEVA Admin', email, hash, 'super_admin', '[]']);
    console.log('Super admin account configured.');
    if (process.env.ADMIN_VERIFY_API === '1') {
        const response = await fetch('http://127.0.0.1:' + (process.env.PORT || '5000') + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: value })
        });
        value = undefined;
        mkdirSync('verification', { recursive: true });
        writeFileSync('verification/admin-login-status.json', JSON.stringify({ status: response.status, checkedAt: new Date().toISOString() }));
        console.log('Login HTTP status: ' + response.status);
        if (response.status !== 200) process.exitCode = 1;
    }
    value = undefined;
}
finally {
    rl.close();
    await pool.end();
} }
main().catch(() => { console.error('Admin setup did not finish. Check the supplied details and database configuration.'); process.exitCode = 1; });
