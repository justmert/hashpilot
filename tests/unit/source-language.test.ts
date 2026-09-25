/**
 * Raw source files must be recognised as code at index time.
 *
 * The chunker only sees code inside markdown fences, so the 327 Solidity
 * contracts indexed from hedera-smart-contracts were stored as prose and were
 * invisible to docs_get_example and code_generate.
 */

import { sourceLanguageFromPath } from '../../src/utils/source-language';

describe('sourceLanguageFromPath', () => {
  it.each([
    [
      'https://github.com/hashgraph/hedera-smart-contracts/blob/main/contracts/base/NoDelegateCall.sol',
      'solidity',
    ],
    ['examples/create_token/main.go', 'go'],
    ['src/Main.java', 'java'],
    ['examples/transfer.py', 'python'],
    ['examples/main.rs', 'rust'],
    ['src/index.ts', 'typescript'],
    ['src/index.mjs', 'javascript'],
    ['https://example.com/file.SOL?raw=true#L10', 'solidity'],
  ])('%s -> %s', (path, expected) => {
    expect(sourceLanguageFromPath(path)).toBe(expected);
  });

  it.each(['README.md', 'docs/guide.mdx', 'notes.txt', 'config.yaml', 'no-extension'])(
    'treats %s as not a source file',
    (path) => {
      expect(sourceLanguageFromPath(path)).toBeUndefined();
    }
  );
});
