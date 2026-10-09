import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(rootDir, '..', 'deploy', 'alvora-backend');
const zipPath = join(rootDir, '..', 'alvora-backend-cpanel.zip');

console.log('Building Backend API...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

if (existsSync(deployDir)) {
  rmSync(deployDir, { recursive: true, force: true });
}
mkdirSync(deployDir, { recursive: true });

console.log('Copying backend files...');
cpSync(join(rootDir, 'dist'), join(deployDir, 'dist'), { recursive: true });
cpSync(join(rootDir, 'package.json'), join(deployDir, 'package.json'));
cpSync(join(rootDir, 'package-lock.json'), join(deployDir, 'package-lock.json'));
cpSync(join(rootDir, 'app.js'), join(deployDir, 'app.js'));

if (existsSync(join(rootDir, '.env'))) {
  cpSync(join(rootDir, '.env'), join(deployDir, '.env'));
}

writeFileSync(
  join(deployDir, 'CPANEL-README.txt'),
  [
    '1. Delete ALL old files in the backend app root, including node_modules.',
    '2. Upload this zip and extract into the app root.',
    '3. IMPORTANT: Go to cPanel Node.js Selector and click "Run NPM Install" (because node_modules is NOT included).',
    '4. Startup file = app.js',
    '5. Node version = 18.x or 20.x preferred.',
    '6. Start the App.',
  ].join('\n')
);

if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

console.log('Creating lightweight backend zip (without node_modules)...');
execSync(`tar -a -c -f "${zipPath}" -C "${deployDir}" .`, { stdio: 'inherit' });

console.log(`cPanel deploy folder ready: ${deployDir}`);
console.log(`cPanel zip ready: ${zipPath}`);
console.log('Done!');
