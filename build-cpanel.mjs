import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(rootDir, 'deploy', 'leva-backend');
const zipPath = join(rootDir, 'leva-backend-cpanel.zip');

console.log('Building Backend API...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

for (const target of [join(rootDir,'deploy'),deployDir]) if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw new Error('Deployment output cannot be a symlink');
if (relative(rootDir, resolve(deployDir)).startsWith('..') || resolve(deployDir) === resolve(rootDir)) throw new Error('Unsafe deployment output path');
if (existsSync(deployDir)) {
  rmSync(deployDir, { recursive: true, force: true });
}
mkdirSync(deployDir, { recursive: true });

console.log('Copying backend files...');
cpSync(join(rootDir, 'dist'), join(deployDir, 'dist'), { recursive: true, filter: source => !/^\.env(?:$|\.)/.test(source.split(/[\\/]/).pop() || '') });
cpSync(join(rootDir, 'package.json'), join(deployDir, 'package.json'));
cpSync(join(rootDir, 'package-lock.json'), join(deployDir, 'package-lock.json'));
cpSync(join(rootDir, 'app.js'), join(deployDir, 'app.js'));

cpSync(join(rootDir, '.env.example'), join(deployDir, '.env.example'));

writeFileSync(
  join(deployDir, 'CPANEL-README.txt'),
  [
    '1. Back up the deployed app and preserve its separately configured environment secrets.',
    '2. Upload this zip and extract into the app root.',
    '3. IMPORTANT: Go to cPanel Node.js Selector and click "Run NPM Install" (because node_modules is NOT included).',
    '4. Startup file = app.js',
    '5. Use a currently supported Node.js runtime compatible with package dependencies (22.x or 24.x recommended).',
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
