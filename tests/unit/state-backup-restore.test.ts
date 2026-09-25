/**
 * State backup and restore round trip.
 *
 * Regression coverage for two bugs: replace-mode restore used to write to a
 * legacy in-package path (so it silently did nothing), and reloading the
 * address book merged into the in-memory map instead of replacing it.
 *
 * tests/setup-env.ts points HASHPILOT_DATA_DIR at a scratch directory, so the
 * singletons below never touch the developer's real ~/.hedera-mcp.
 */

import fs from 'fs/promises';
import path from 'path';
import { addressBook, AddressBookEntry } from '../../src/services/addressbook';
import { stateService } from '../../src/services/state';
import { getPackageVersion } from '../../src/utils/version';

const entry = (
  alias: string,
  accountId: string
): Omit<AddressBookEntry, 'createdAt' | 'updatedAt'> => ({
  alias,
  accountId,
  nickname: `nickname-${alias}`,
});

async function resetAddressBook(): Promise<void> {
  await addressBook.replaceAll([]);
}

describe('state backup and restore', () => {
  beforeEach(async () => {
    await resetAddressBook();
  });

  afterAll(async () => {
    await resetAddressBook();
  });

  it('writes a backup under the data directory and stamps the package version', async () => {
    await addressBook.add(entry('alice', '0.0.1001'));
    const result = await stateService.backup();

    expect(result.itemCount).toBe(1);
    expect(result.filePath).toContain(process.env.HASHPILOT_DATA_DIR!);

    const backup = JSON.parse(await fs.readFile(result.filePath, 'utf-8'));
    expect(backup.serverVersion).toBe(getPackageVersion());
    expect(backup.serverVersion).not.toBe('0.1.0');
    expect(backup.backup.addressBook).toHaveLength(1);
    expect(backup.backup.addressBook[0].alias).toBe('alice');
  });

  it('honours a custom backup filename', async () => {
    const result = await stateService.backup(false, undefined, 'my-backup');
    expect(path.basename(result.filePath)).toBe('my-backup.json');
    const withExt = await stateService.backup(false, undefined, 'other.json');
    expect(path.basename(withExt.filePath)).toBe('other.json');
  });

  it('excludes private keys by default and warns', async () => {
    await addressBook.add({ ...entry('bob', '0.0.1002'), privateKey: 'deadbeef' });
    const result = await stateService.backup();
    const backup = JSON.parse(await fs.readFile(result.filePath, 'utf-8'));

    expect(backup.backup.addressBook[0].privateKey).toBeUndefined();
    expect(backup.backup.addressBook[0].hasPrivateKey).toBe(true);
    expect(result.warning).toMatch(/private keys were excluded/i);
  });

  it('replace-mode restore actually replaces the live address book', async () => {
    await addressBook.add(entry('alice', '0.0.1001'));
    const { filePath } = await stateService.backup();

    // Diverge from the backup: drop alice, add carol
    await addressBook.remove('alice');
    await addressBook.add(entry('carol', '0.0.1003'));
    expect(addressBook.list().map((e) => e.alias)).toEqual(['carol']);

    const restored = await stateService.restore(filePath, false);

    expect(restored.restoredItems).toBe(1);
    // The bug: this used to still be ['carol'] because the restore wrote to a
    // legacy path and the reload merged instead of replacing.
    expect(addressBook.list().map((e) => e.alias)).toEqual(['alice']);

    // and it must be persisted where the address book actually reads from
    const onDisk = JSON.parse(await fs.readFile(addressBook.getPath(), 'utf-8'));
    expect(onDisk.map((e: AddressBookEntry) => e.alias)).toEqual(['alice']);
  });

  it('merge-mode restore keeps entries that are not in the backup', async () => {
    await addressBook.add(entry('alice', '0.0.1001'));
    const { filePath } = await stateService.backup();

    await addressBook.remove('alice');
    await addressBook.add(entry('carol', '0.0.1003'));

    await stateService.restore(filePath, true);

    expect(
      addressBook
        .list()
        .map((e) => e.alias)
        .sort()
    ).toEqual(['alice', 'carol']);
  });

  it('rejects a malformed or incompatible backup', async () => {
    const dir = process.env.HASHPILOT_DATA_DIR!;
    const bad = path.join(dir, 'bad-backup.json');
    await fs.writeFile(bad, JSON.stringify({ nope: true }));
    await expect(stateService.restore(bad, false)).rejects.toThrow(/Invalid backup format/);

    const oldVersion = path.join(dir, 'old-backup.json');
    await fs.writeFile(oldVersion, JSON.stringify({ version: '0.0.1', backup: {} }));
    await expect(stateService.restore(oldVersion, false)).rejects.toThrow(
      /Incompatible backup version/
    );
  });

  it('exports to the data directory when no path is given', async () => {
    const result = await stateService.export();
    expect(result.filePath).toContain(path.join(process.env.HASHPILOT_DATA_DIR!, 'exports'));
    const exported = JSON.parse(await fs.readFile(result.filePath, 'utf-8'));
    expect(exported.serverVersion).toBe(getPackageVersion());
  });
});
