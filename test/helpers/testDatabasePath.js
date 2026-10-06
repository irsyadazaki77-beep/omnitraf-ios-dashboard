import path from 'node:path';
import os from 'node:os';

export function testDatabasePath(name) {
  const directory = process.env.TEST_DATA_DIR || path.join(os.tmpdir(), 'omnitraf-tests');
  return path.join(directory, name);
}
