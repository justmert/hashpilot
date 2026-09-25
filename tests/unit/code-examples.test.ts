/**
 * Code example extraction and filtering.
 *
 * Regression coverage for `docs_get_example` returning nothing at all. Three
 * defects stacked up:
 *
 *   1. Extraction only understood ```-fenced markdown, so the raw `.go`,
 *      `.java`, `.py` and `.rs` files indexed from the SDK repositories — where
 *      the chunk *is* the example — yielded no code.
 *   2. The ChromaDB language filter was commented out, because a multi-key
 *      `where` object is rejected by the v2 API, so a request for Go examples
 *      was answered with whatever the embedding preferred.
 *   3. The fence regex paired backticks blindly, so a chunk that began with a
 *      stray closing fence returned the prose after it as "code".
 */

import { RAGService } from '../../src/services/rag-service';
import { Chunk } from '../../src/types/rag';

const service = new RAGService({
  chromaService: {} as any,
  embeddingService: {} as any,
  openai: {} as any,
});

const extract = (chunk: Chunk, score = 0.8, preferred?: string): any[] =>
  (service as any).extractCodeFromText(chunk, score, preferred);

function makeChunk(text: string, overrides: Partial<Chunk['metadata']> = {}): Chunk {
  return {
    id: 'c1',
    documentId: 'd1',
    text,
    index: 0,
    totalChunks: 1,
    metadata: {
      url: 'https://docs.hedera.com/native/tutorials/tokens/create-first-token',
      title: 'Create a Token',
      contentType: 'tutorial',
      hasCode: true,
      tags: [],
      crawledAt: new Date().toISOString(),
      documentId: 'd1',
      chunkIndex: 0,
      totalChunks: 1,
      ...overrides,
    },
  };
}

describe('extractCodeFromText', () => {
  it('extracts a fenced block with a plain language label', () => {
    const examples = extract(
      makeChunk(
        'Intro text\n\n```javascript\nconst client = Client.forTestnet();\nclient.setOperator(id, key);\n```'
      )
    );

    expect(examples).toHaveLength(1);
    expect(examples[0].language).toBe('javascript');
    expect(examples[0].code).toContain('Client.forTestnet()');
    expect(examples[0].code).not.toContain('```');
  });

  it('reads the language from an info string that carries a tab label', () => {
    // docs.hedera.com writes its language tabs as ```java Java
    const examples = extract(
      makeChunk('```java Java\nTokenCreateTransaction tx = new TokenCreateTransaction();\n```')
    );

    expect(examples).toHaveLength(1);
    expect(examples[0].language).toBe('java');
    expect(examples[0].code).toContain('TokenCreateTransaction');
  });

  it('normalises abbreviated fence labels', () => {
    const examples = extract(makeChunk('```py\nclient = Client.for_testnet()\nprint(client)\n```'));
    expect(examples[0].language).toBe('python');
  });

  it('keeps an unrecognised fence label instead of calling it JavaScript', () => {
    const examples = extract(makeChunk('```bash\nnpm install @hashgraph/sdk --save\n```'));
    expect(examples[0].language).toBe('bash');
  });

  it('handles a block nested inside a four-backtick fence', () => {
    const text = [
      '````',
      '```js',
      'const tokenId = receipt.tokenId;',
      'console.log(tokenId.toString());',
      '```',
      '````',
    ].join('\n');

    const examples = extract(makeChunk(text));
    expect(examples).toHaveLength(1);
    expect(examples[0].code).toContain('receipt.tokenId');
  });

  it('does not return prose that follows a stray closing fence', () => {
    // Chunk overlap used to slice mid-block, leaving a chunk that opens with a
    // closing fence. Pairing it with the next fence captured the prose between.
    const text = [
      'const tokenId = receipt.tokenId;',
      '```',
      '',
      '**Security reminder**: keep your private keys safe.',
      '',
      'Now continue to the next step of the tutorial and read on.',
    ].join('\n');

    const examples = extract(makeChunk(text, { language: 'go' }));
    expect(examples).toHaveLength(0);
  });

  it('still recovers a labelled block that follows a stray closing fence', () => {
    const text = [
      'onst txResponse = await signedTx.execute(client);',
      '````',
      '```java Java',
      'TokenCreateTransaction transaction = new TokenCreateTransaction()',
      '    .setTokenName("Example Token");',
      '```',
    ].join('\n');

    const examples = extract(makeChunk(text, { language: 'go' }));
    expect(examples).toHaveLength(1);
    expect(examples[0].language).toBe('java');
    expect(examples[0].code).toContain('setTokenName');
    expect(examples[0].code).not.toContain('txResponse');
  });

  it('treats an unfenced source file chunk as the example itself', () => {
    // How every SDK example is indexed: the chunk is the raw file.
    const goSource = [
      '// Create a fungible token with a supply key',
      'func main() {',
      '\tsupplyKey, _ := hedera.PrivateKeyGenerateEd25519()',
      '\tfmt.Println(supplyKey)',
      '}',
    ].join('\n');

    const examples = extract(
      makeChunk(goSource, {
        url: 'https://github.com/hiero-ledger/hiero-sdk-go/blob/main/examples/create_token/main.go',
        language: 'go',
      })
    );

    expect(examples).toHaveLength(1);
    expect(examples[0].language).toBe('go');
    expect(examples[0].code).toContain('PrivateKeyGenerateEd25519');
    expect(examples[0].explanation).toContain('Create a fungible token');
  });

  it.each([
    ['main.py', 'python'],
    ['Main.java', 'java'],
    ['main.rs', 'rust'],
    ['index.ts', 'typescript'],
  ])('derives the language of %s from its extension', (file, expected) => {
    const examples = extract(
      makeChunk('some_call_that_is_long_enough(argument, other)\nreturn 1', {
        url: `https://github.com/hiero-ledger/sdk/blob/main/examples/${file}`,
      })
    );

    expect(examples[0].language).toBe(expected);
  });

  it('never dumps prose out as code just because the page has a language', () => {
    // A multi-language tutorial page carries `language` metadata too; without a
    // source-file URL the fallback must stay quiet rather than return prose.
    const examples = extract(
      makeChunk('This tutorial walks through creating your first token on Hedera.', {
        language: 'go',
      })
    );

    expect(examples).toHaveLength(0);
  });

  it('never uses code as the explanation for a code block', () => {
    // A multi-language tutorial page puts a Java block right above a Go one;
    // taking the three preceding lines described the Go example with Java.
    const text = [
      'TokenCreateTransaction transaction = new TokenCreateTransaction()',
      '    .setTokenName("Example");',
      '```go',
      'supplyKey, _ := hedera.PrivateKeyGenerateEd25519()',
      'fmt.Println(supplyKey)',
      '```',
    ].join('\n');

    const examples = extract(makeChunk(text));
    expect(examples).toHaveLength(1);
    expect(examples[0].explanation).toBe('');
  });

  it('keeps a real sentence as the explanation', () => {
    const text = [
      'Create the token with a supply key so that new units can be minted later.',
      '```javascript',
      'const tx = new TokenCreateTransaction().setSupplyKey(key);',
      '```',
    ].join('\n');

    expect(extract(makeChunk(text))[0].explanation).toBe(
      'Create the token with a supply key so that new units can be minted later.'
    );
  });

  it('does not describe an example with a Rust attribute macro', () => {
    const text = [
      '#[derive(Parser, Debug)]',
      '#[clap(long, env)]',
      '```rust',
      'let client = Client::for_testnet();',
      'client.set_operator(id, key);',
      '```',
    ].join('\n');

    expect(extract(makeChunk(text))[0].explanation).toBe('');
  });

  it('describes a source file from its leading comment only', () => {
    const goSource = [
      '// Create a fungible token with a supply key.',
      '// Part of the SDK examples.',
      '',
      'func main() {',
      '\t// unrelated remark further down',
      '\tsupplyKey, _ := hedera.PrivateKeyGenerateEd25519()',
      '}',
    ].join('\n');

    const examples = extract(
      makeChunk(goSource, {
        url: 'https://github.com/hiero-ledger/hiero-sdk-go/blob/main/examples/token/main.go',
        language: 'go',
      })
    );

    expect(examples[0].explanation).toBe(
      'main.go: Create a fungible token with a supply key. Part of the SDK examples.'
    );
    expect(examples[0].explanation).not.toContain('unrelated remark');
  });

  it('skips blocks that are too short to be useful', () => {
    expect(extract(makeChunk('```js\nx = 1\n```'))).toHaveLength(0);
  });

  it('boosts the score of a block in the requested language', () => {
    const text = '```go\nsupplyKey, _ := hedera.PrivateKeyGenerateEd25519()\n```';
    const plain = extract(makeChunk(text))[0];
    const preferred = extract(makeChunk(text), 0.8, 'go')[0];

    expect(preferred.score).toBeGreaterThan(plain.score);
  });
});
