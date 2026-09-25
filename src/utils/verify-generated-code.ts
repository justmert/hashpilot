/**
 * Check generated code against the documentation it was generated from.
 *
 * Grounding rules in the prompt made the model hedge far more honestly, but
 * they did not stop it inventing specific names. Verified examples: a Go import
 * of `github.com/hashgraph/hierarchical-sdk-go/v2` (no such module; the real one
 * is `github.com/hiero-ledger/hiero-sdk-go/v2/sdk`, and it was sitting in the
 * model's own retrieved context), and `FractionalFee.setNetOfTransfers()` (the
 * class is `CustomFractionalFee` and that setter does not exist).
 *
 * A language model asked not to hallucinate will still sometimes hallucinate,
 * so this does not try to prevent it. It reports which names in the generated
 * code could not be found in the retrieved documentation, so the caller gets a
 * signal instead of plausible-looking fiction. Absence from the context is not
 * proof a name is wrong — it means nothing retrieved supports it.
 */

/** Names that belong to a language or its standard library, not to an SDK */
const BUILTIN_IDENTIFIERS = new Set([
  // JavaScript / TypeScript
  'JSON',
  'Promise',
  'Error',
  'Math',
  'Date',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'Map',
  'Set',
  'BigInt',
  'Buffer',
  'Uint8Array',
  'RegExp',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Function',
  'TypeError',
  'RangeError',
  'Infinity',
  'NaN',
  'Record',
  'Partial',
  'Readonly',
  'Awaited',
  // Java
  'System',
  'Exception',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Short',
  'Byte',
  'Character',
  'List',
  'ArrayList',
  'HashMap',
  'Optional',
  'Collections',
  'Arrays',
  'Objects',
  'Thread',
  'Runnable',
  'Override',
  'Instant',
  'Duration',
  'BigDecimal',
  'BigInteger',
  'IOException',
  'InterruptedException',
  // Python
  'None',
  'True',
  'False',
  'Exception',
  'ValueError',
  'TypeError',
  'KeyError',
  'Decimal',
  'Dict',
  'List',
  'Optional',
  'Any',
  'Tuple',
  'Union',
  // Go
  'Sprintf',
  'Println',
  'Printf',
  'Errorf',
  'Fatal',
  'Fatalf',
  'Getenv',
  'Context',
  'Background',
  'TODO',
  // Rust
  'Result',
  'Option',
  'Some',
  'None',
  'Ok',
  'Err',
  'Box',
  'Vec',
  'Self',
  'String',
  'Arc',
  'Mutex',
  'Default',
  'Clone',
  'Debug',
  'Duration',
  // Solidity / general
  'SPDX',
  'MIT',
  'ERC20',
  'ERC721',
  'ERC1155',
  'IERC20',
  'IERC721',
]);

/** Module specifiers that are language or ecosystem standard, not Hedera SDKs */
const STANDARD_MODULE_PREFIXES = [
  'fmt',
  'os',
  'time',
  'context',
  'errors',
  'strings',
  'strconv',
  'log',
  'encoding/',
  'net/',
  'io',
  'math',
  'sync',
  'bytes',
  'sort',
  'java.',
  'javax.',
  'dotenv',
  'fs',
  'path',
  'crypto',
  'util',
  'events',
  'std::',
  'core::',
  'alloc::',
  'tokio',
  'serde',
  'anyhow',
  'clap',
  'typing',
  'asyncio',
  'json',
  'datetime',
  'decimal',
  'dataclasses',
  '@openzeppelin/',
  'hardhat/',
];

export interface CodeVerification {
  /** Module/import paths not present in the retrieved documentation */
  unverifiedImports: string[];
  /** SDK-looking identifiers not present in the retrieved documentation */
  unverifiedIdentifiers: string[];
  /** Human-readable warning, or undefined when everything checked out */
  warning?: string;
}

/** Pull module specifiers out of code in any of the supported languages */
function extractImports(code: string): string[] {
  const found = new Set<string>();

  const patterns: RegExp[] = [
    /(?:from|require\s*\()\s*['"]([^'"]+)['"]/g, // JS/TS
    /^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/gm, // JS/TS bare import
    /^\s*import\s+([\w.]+)\s*;/gm, // Java
    /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm, // Python
    /^\s*use\s+([\w:]+)/gm, // Rust
    /^\s*(?:[\w.]+\s+)?"((?:github\.com|golang\.org|gopkg\.in)\/[^"]+)"/gm, // Go
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const specifier = (match[1] || match[2] || '').trim();
      if (specifier) found.add(specifier);
    }
  }

  return Array.from(found).filter(
    (specifier) =>
      !STANDARD_MODULE_PREFIXES.some(
        (prefix) => specifier === prefix.replace(/[/.:]+$/, '') || specifier.startsWith(prefix)
      )
  );
}

/**
 * Code with comments and string literals removed.
 *
 * Identifiers are only meaningful in code. Scanning comments flagged the first
 * word of every sentence ("// Create a client", "// Define the amount") as an
 * unverified API name, which buried the real findings in noise.
 */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/("""|''')[\s\S]*?\1/g, ' ') // Python docstrings
    .replace(/`(?:\\.|[^`\\])*`/g, ' ') // template literals
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' ') // double-quoted strings
    .replace(/'(?:\\.|[^'\\\n])*'/g, ' ') // single-quoted strings
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ') // line comments
    .replace(/(^|\s)#(?!\[)[^\n]*/g, '$1'); // Python/shell comments, keeping Rust #[attributes]
}

/** Pull SDK-looking (PascalCase) identifiers out of code */
function extractIdentifiers(code: string): string[] {
  const found = new Set<string>();
  const pattern = /\b[A-Z][A-Za-z0-9]{2,}\b/g;
  const codeOnly = stripCommentsAndStrings(code);

  let match;
  while ((match = pattern.exec(codeOnly)) !== null) {
    const identifier = match[0];
    if (!BUILTIN_IDENTIFIERS.has(identifier)) {
      found.add(identifier);
    }
  }

  return Array.from(found);
}

/** Does `name` appear in the context as a whole word? */
function appearsInContext(name: string, context: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(context);
}

export function verifyGeneratedCode(
  code: string,
  context: string,
  options: { maxReported?: number } = {}
): CodeVerification {
  const maxReported = options.maxReported ?? 8;

  if (!code.trim() || !context.trim()) {
    return { unverifiedImports: [], unverifiedIdentifiers: [] };
  }

  const unverifiedImports = extractImports(code)
    .filter((specifier) => !context.includes(specifier))
    .slice(0, maxReported);

  const unverifiedIdentifiers = extractIdentifiers(code)
    .filter((identifier) => !appearsInContext(identifier, context))
    .slice(0, maxReported);

  if (unverifiedImports.length === 0 && unverifiedIdentifiers.length === 0) {
    return { unverifiedImports, unverifiedIdentifiers };
  }

  const parts: string[] = [];
  if (unverifiedImports.length > 0) {
    parts.push(`import paths (${unverifiedImports.join(', ')})`);
  }
  if (unverifiedIdentifiers.length > 0) {
    parts.push(`identifiers (${unverifiedIdentifiers.join(', ')})`);
  }

  return {
    unverifiedImports,
    unverifiedIdentifiers,
    warning:
      `Not verified against the retrieved documentation: ${parts.join(' and ')}. ` +
      'These may be correct, but nothing in the sources below confirms them — ' +
      'check them against the SDK reference before running this code.',
  };
}
