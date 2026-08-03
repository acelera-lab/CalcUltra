import fs from 'node:fs';

for (const file of ['data/test.sqlite', 'data/test.sqlite-wal', 'data/test.sqlite-shm']) {
  fs.rmSync(file, { force: true });
}
