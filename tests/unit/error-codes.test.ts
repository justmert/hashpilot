import {
  HEDERA_ERROR_CODES,
  getErrorInfo,
  extractErrorCode,
  searchErrors,
  getErrorsByCategory,
} from '../../src/utils/hedera-error-codes';
import { analyzeError } from '../../src/services/error-analyzer';

describe('hedera error code catalogue', () => {
  it('covers the codes users hit most', () => {
    for (const code of [
      'INSUFFICIENT_PAYER_BALANCE',
      'INVALID_SIGNATURE',
      'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
      'CONTRACT_REVERT_EXECUTED',
      'INVALID_ACCOUNT_ID',
    ]) {
      const info = getErrorInfo(code);
      expect(info).toBeDefined();
      expect(info!.description.length).toBeGreaterThan(10);
      expect(info!.solution.length).toBeGreaterThan(10);
    }
    expect(Object.keys(HEDERA_ERROR_CODES).length).toBeGreaterThanOrEqual(50);
  });

  it('extracts a code from an SDK error message', () => {
    expect(
      extractErrorCode(
        'transaction 0.0.1234@1788865001.346910417 failed precheck with status INVALID_SIGNATURE against node account id 0.0.5'
      )
    ).toBe('INVALID_SIGNATURE');
    expect(extractErrorCode('nothing here')).toBeUndefined();
  });

  it('searches by keyword and category', () => {
    expect(searchErrors('associat').map((e) => e.code)).toContain(
      'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT'
    );
    expect(getErrorsByCategory('token').length).toBeGreaterThan(3);
  });
});

describe('error analyzer', () => {
  it('produces guidance and a severity for a known code', () => {
    const analysis = analyzeError('INSUFFICIENT_PAYER_BALANCE');
    expect(analysis.errorCode).toBe('INSUFFICIENT_PAYER_BALANCE');
    expect(analysis.guidance).toMatch(/fund|balance/i);
    expect(['low', 'medium', 'high', 'critical']).toContain(analysis.severity);
  });

  it('flags private key exposure in error text as a security recommendation', () => {
    const analysis = analyzeError('failed: privateKey=302e020100300506032b657004220420abcdef');
    expect(analysis.securityRecommendations.length).toBeGreaterThan(0);
  });

  it('still returns guidance for an unknown error', () => {
    const analysis = analyzeError(new Error('something odd happened'));
    expect(analysis.guidance.length).toBeGreaterThan(0);
  });
});
