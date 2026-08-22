// Cross-platform version of update_photos.bat (for macOS/Linux, or anyone with Node installed).
// Run: node build-photo-manifest.mjs
// It scans assets/photos/ and rewrites assets/photos.js used by index.html.
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join('assets', 'photos');
const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const files = (await readdir(dir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
  .map(entry => `assets/photos/${entry.name}`)
  .sort((a, b) => a.localeCompare(b));

const header = '// Generated automatically. Run update_photos.bat (Windows) or `node build-photo-manifest.mjs` (Mac/Linux) after editing assets/photos/.\n';
const body = files.map(f => `  "${f}"`).join(',\n');
const out = `${header}window.JPP_PHOTOS = [\n${body}\n];\n`;

await writeFile(path.join('assets', 'photos.js'), out);
console.log(`Photo manifest generated: ${files.length} photo(s).`);
