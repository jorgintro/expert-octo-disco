import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const { version } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'));
