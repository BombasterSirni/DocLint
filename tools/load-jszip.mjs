import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const vendorPath = fileURLToPath(new URL('../assets/vendor/jszip.min.js', import.meta.url));
let cached = null;

/** Загружает локальный UMD-файл JSZip без npm-зависимостей. */
export default function loadJSZip() {
  if (cached) return cached;
  const source = readFileSync(vendorPath, 'utf8');
  const moduleShim = { exports: {} };
  const factory = new Function('module', 'exports', 'define', `${source}\n;return module.exports;`);
  cached = factory(moduleShim, moduleShim.exports, undefined);
  return cached;
}
