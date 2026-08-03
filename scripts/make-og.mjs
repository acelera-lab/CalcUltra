import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await sharp(path.join(root, 'scripts/og-image.svg'))
  .resize(1200, 630)
  .png()
  .toFile(path.join(root, 'public/og-image.png'));

console.log('public/og-image.png gerado');
