import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoDocx } from '../assets/js/demo.js';
import loadJSZip from './load-jszip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'sample/demo.docx');

const bytes = await buildDemoDocx(loadJSZip(), 'nodebuffer');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log(`Демонстрационный документ записан: ${target}`);
