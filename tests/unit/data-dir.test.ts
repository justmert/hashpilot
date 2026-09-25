import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDataDir, migrateLegacyFile } from '../../src/utils/data-dir';

describe('data directory', () => {
  const original = process.env.HASHPILOT_DATA_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.HASHPILOT_DATA_DIR;
    else process.env.HASHPILOT_DATA_DIR = original;
  });

  it('defaults to ~/.hedera-mcp', () => {
    delete process.env.HASHPILOT_DATA_DIR;
    expect(getDataDir()).toBe(path.join(os.homedir(), '.hedera-mcp'));
  });

  it('honours HASHPILOT_DATA_DIR', () => {
    process.env.HASHPILOT_DATA_DIR = '/tmp/hp-data';
    expect(getDataDir()).toBe(path.resolve('/tmp/hp-data'));
  });

  it('migrates a legacy file once and never overwrites an existing target', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hp-migrate-'));
    const legacy = path.join(dir, 'legacy', 'addressbook.json');
    const target = path.join(dir, 'new', 'nested', 'addressbook.json');
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, '[{"alias":"a"}]');

    expect(await migrateLegacyFile(legacy, target)).toBe(true);
    expect(await fs.readFile(target, 'utf-8')).toBe('[{"alias":"a"}]');

    await fs.writeFile(target, '[]');
    expect(await migrateLegacyFile(legacy, target)).toBe(false);
    expect(await fs.readFile(target, 'utf-8')).toBe('[]');

    expect(await migrateLegacyFile(path.join(dir, 'missing.json'), path.join(dir, 'x.json'))).toBe(
      false
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
