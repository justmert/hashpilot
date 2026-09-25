/**
 * Jest setup: runs before any test module is imported.
 *
 * Several services construct singletons at import time that resolve the data
 * directory (address book, state, deployment history). Point that at a
 * throwaway directory so tests never read or write the developer's real
 * ~/.hedera-mcp, and keep tests off the network by default.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashpilot-test-data-'));
process.env.HASHPILOT_DATA_DIR = dataDir;

// Unit tests must not pick up developer credentials from the environment.
delete process.env.HEDERA_OPERATOR_ID;
delete process.env.HEDERA_OPERATOR_KEY;
delete process.env.HEDERA_OPERATOR_KEY_TYPE;

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
