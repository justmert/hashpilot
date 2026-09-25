/**
 * Detection of generated names that the retrieved documentation does not support.
 *
 * Grounding rules in the prompt made answers hedge honestly but did not stop the
 * model inventing specific names. Both cases below were verified against reality:
 * `github.com/hashgraph/hierarchical-sdk-go/v2` returns 404 (the real module is
 * `github.com/hiero-ledger/hiero-sdk-go/v2/sdk`, and it was in the model's own
 * retrieved context), and `FractionalFee.setNetOfTransfers()` does not exist —
 * the class is `CustomFractionalFee` and the behaviour is set through
 * `setAssessmentMethod()`.
 */

import { verifyGeneratedCode } from '../../src/utils/verify-generated-code';

describe('verifyGeneratedCode', () => {
  it('flags a fabricated Go module path', () => {
    const context = 'import hiero "github.com/hiero-ledger/hiero-sdk-go/v2/sdk"';
    const code = [
      'import (',
      '\t"fmt"',
      '\t"github.com/hashgraph/hierarchical-sdk-go/v2/client"',
      ')',
    ].join('\n');

    const result = verifyGeneratedCode(code, context);

    expect(result.unverifiedImports).toContain(
      'github.com/hashgraph/hierarchical-sdk-go/v2/client'
    );
    expect(result.warning).toMatch(/not verified against the retrieved documentation/i);
  });

  it('accepts the module path that is actually in the context', () => {
    const context = 'import hiero "github.com/hiero-ledger/hiero-sdk-go/v2/sdk"';
    const code = 'import hiero "github.com/hiero-ledger/hiero-sdk-go/v2/sdk"';

    expect(verifyGeneratedCode(code, context).unverifiedImports).toEqual([]);
  });

  it('flags a class name that only looks like one in the context', () => {
    // The context has CustomFractionalFee; FractionalFee is a different name and
    // must not be treated as present just because it is a substring.
    const context = 'new CustomFractionalFee().setNumerator(1).setDenominator(10)';
    const code = 'new FractionalFee().setNumerator(1)';

    expect(verifyGeneratedCode(code, context).unverifiedIdentifiers).toContain('FractionalFee');
  });

  it('accepts an identifier present in the context as a whole word', () => {
    const context = 'const tx = new CustomFractionalFee();';
    const code = 'const fee = new CustomFractionalFee();';

    expect(verifyGeneratedCode(code, context).unverifiedIdentifiers).toEqual([]);
  });

  it('does not flag language builtins', () => {
    const context = 'nothing relevant here';
    const code = [
      'const data = JSON.stringify({ ok: true });',
      'const when = new Date();',
      'throw new Error("boom");',
      'const items = new Map();',
    ].join('\n');

    expect(verifyGeneratedCode(code, context).unverifiedIdentifiers).toEqual([]);
  });

  it('does not flag standard library imports', () => {
    const context = 'nothing relevant here';
    const code = [
      'import fs from "fs";',
      'import path from "path";',
      'import "dotenv/config";',
    ].join('\n');

    expect(verifyGeneratedCode(code, context).unverifiedImports).toEqual([]);
  });

  it('flags an npm install that names a Python package', () => {
    const context = 'npm install @hashgraph/sdk';
    const code = 'import { ChatOpenAI } from "langchain-openai";';

    expect(verifyGeneratedCode(code, context).unverifiedImports).toContain('langchain-openai');
  });

  it('reports nothing when the code is fully grounded', () => {
    const context = 'const { Client, TokenCreateTransaction } = require("@hashgraph/sdk");';
    const code = [
      'const { Client, TokenCreateTransaction } = require("@hashgraph/sdk");',
      'const client = Client.forTestnet();',
    ].join('\n');

    const result = verifyGeneratedCode(code, context);
    expect(result.warning).toBeUndefined();
    expect(result.unverifiedImports).toEqual([]);
    expect(result.unverifiedIdentifiers).toEqual([]);
  });

  it('ignores words in comments and strings', () => {
    // The first word of each comment sentence was reported as an unverified
    // identifier, burying real findings under "Create", "Define", "Deduct".
    const context = 'new TransferTransaction().addHbarTransfer(from, amount)';
    const code = [
      '// Create a client and Define the amount',
      '/* Deduct from the sender, then Add to the receiver */',
      '# Python Style Comment Here',
      'const note = "Transfer Complete";',
      'const tx = new TransferTransaction().addHbarTransfer(from, amount);',
    ].join('\n');

    const result = verifyGeneratedCode(code, context);
    expect(result.unverifiedIdentifiers).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it('still flags a fabricated class used in code next to comments', () => {
    const context = 'new CustomFractionalFee()';
    const code = ['// Create the fee', 'const fee = new FractionalFee();'].join('\n');

    expect(verifyGeneratedCode(code, context).unverifiedIdentifiers).toEqual(['FractionalFee']);
  });

  it('caps how much it reports so the warning stays readable', () => {
    const code = Array.from({ length: 30 }, (_, i) => `const x${i} = new Fake${i}Thing();`).join(
      '\n'
    );
    const result = verifyGeneratedCode(code, 'unrelated context', { maxReported: 5 });

    expect(result.unverifiedIdentifiers).toHaveLength(5);
  });

  it('stays quiet when there is no code or no context to check against', () => {
    expect(verifyGeneratedCode('', 'context').warning).toBeUndefined();
    expect(verifyGeneratedCode('const a = new Thing();', '').warning).toBeUndefined();
  });
});
