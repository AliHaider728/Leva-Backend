import { existsSync,lstatSync,rmSync } from 'node:fs';
import { resolve,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const output=resolve(root,'dist');
if(dirname(output)!==root||basename(output)!=='dist'||(existsSync(output)&&lstatSync(output).isSymbolicLink()))throw new Error('Unsafe generated output path.');
if(existsSync(output))rmSync(output,{recursive:true,force:true});
