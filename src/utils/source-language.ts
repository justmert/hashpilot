/**
 * Source-file language detection for indexers.
 *
 * The chunker infers `hasCode` from markdown fences, so a raw source file
 * (a `.sol` contract, a `.go` example) is stored as prose unless the indexer
 * says otherwise. That hid SDK examples from the code tools once, and later the
 * 327 Solidity contracts from `hedera-smart-contracts`. Indexers call this on a
 * document's path and mark its chunks as code when it returns a language.
 */

import { ProgrammingLanguage } from '../types/rag.js';

const EXTENSION_LANGUAGES: Record<string, ProgrammingLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  go: 'go',
  java: 'java',
  rs: 'rust',
  sol: 'solidity',
};

/** Language of a source file from its path or URL, or undefined for docs and unknown types */
export function sourceLanguageFromPath(pathOrUrl: string): ProgrammingLanguage | undefined {
  const path = pathOrUrl.split(/[?#]/)[0];
  const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? EXTENSION_LANGUAGES[extension] : undefined;
}
