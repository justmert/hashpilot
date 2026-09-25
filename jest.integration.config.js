import base from './jest.config.js';

// Integration tests: require `npm run build` and live OPENAI_API_KEY / CHROMA_URL
export default {
  ...base,
  testMatch: ['**/tests/integration/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 120000,
};
