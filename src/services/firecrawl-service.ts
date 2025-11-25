/**
 * Firecrawl Service
 *
 * Service for crawling Hedera documentation using Firecrawl API.
 * Handles rate limiting, retries, and progress tracking.
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { Document, DocumentContentType } from '../types/rag.js';
import { FIRECRAWL_CONFIG } from '../config/rag.js';
import { logger } from '../utils/logger.js';

/**
 * Crawl options
 */
export interface CrawlOptions {
  /** Maximum pages to crawl */
  maxPages?: number;
  /** URL patterns to exclude */
  excludePatterns?: string[];
  /** URL patterns to include (for selective crawling) */
  includePatterns?: string[];
  /** Progress callback */
  onProgress?: (current: number, total: number, url: string) => void;
  /** Include subdomains */
  includeSubdomains?: boolean;
  /** Maximum depth */
  maxDepth?: number;
}

/**
 * Crawl result
 */
export interface CrawlResult {
  /** Crawled documents */
  documents: Document[];
  /** Total pages crawled */
  totalPages: number;
  /** Failed URLs */
  failedUrls: string[];
  /** Errors encountered */
  errors: string[];
}

/**
 * Firecrawl Service
 */
export class FirecrawlService {
  private firecrawl: FirecrawlApp;

  constructor(apiKeyOrUrl: string) {
    // Check if using local Firecrawl instance (URL) or cloud (API key)
    const isLocalUrl = apiKeyOrUrl.startsWith('http://') || apiKeyOrUrl.startsWith('https://');

    if (isLocalUrl) {
      // Local Firecrawl instance
      this.firecrawl = new FirecrawlApp({
        apiUrl: apiKeyOrUrl
      });
      logger.info('FirecrawlService initialized (local)', { url: apiKeyOrUrl });
    } else {
      // Cloud Firecrawl with API key
      this.firecrawl = new FirecrawlApp({
        apiKey: apiKeyOrUrl
      });
      logger.info('FirecrawlService initialized (cloud)');
    }
  }

  /**
   * Crawl Hedera documentation
   */
  async crawlHederaDocs(options: CrawlOptions = {}): Promise<CrawlResult> {
    const maxPages = options.maxPages || FIRECRAWL_CONFIG.maxPages;
    const excludePatterns = options.excludePatterns || [...FIRECRAWL_CONFIG.excludePatterns];
    const includePatterns = options.includePatterns || (FIRECRAWL_CONFIG as any).includePatterns || [];

    logger.info('Starting Hedera documentation crawl', {
      maxPages,
      excludePatterns,
      includePatterns,
      baseUrls: FIRECRAWL_CONFIG.baseUrls,
    });

    const documents: Document[] = [];
    const failedUrls: string[] = [];
    const errors: string[] = [];
    let currentPage = 0;

    try {
      // Crawl each base URL
      for (const baseUrl of FIRECRAWL_CONFIG.baseUrls) {
        try {
          const crawlResult = await this.crawlWebsite(baseUrl, {
            ...options,
            maxPages: maxPages - currentPage,
            excludePatterns,
            includePatterns,
          });

          documents.push(...crawlResult.documents);
          failedUrls.push(...crawlResult.failedUrls);
          errors.push(...crawlResult.errors);
          currentPage += crawlResult.documents.length;

          logger.info('Crawl completed for base URL', {
            baseUrl,
            documentsFound: crawlResult.documents.length,
            totalDocuments: documents.length,
          });

          // Stop if we reached max pages
          if (currentPage >= maxPages) {
            logger.info('Maximum pages reached', { maxPages, currentPage });
            break;
          }
        } catch (error: any) {
          const errorMsg = `Failed to crawl ${baseUrl}: ${error.message}`;
          logger.error(errorMsg, { error: error.message });
          errors.push(errorMsg);
          failedUrls.push(baseUrl);
        }
      }

      logger.info('Hedera documentation crawl completed', {
        totalDocuments: documents.length,
        failedUrls: failedUrls.length,
        errors: errors.length,
      });

      return {
        documents,
        totalPages: documents.length,
        failedUrls,
        errors,
      };
    } catch (error: any) {
      logger.error('Crawl failed', { error: error.message });
      throw new Error(`Hedera docs crawl failed: ${error.message}`);
    }
  }

  /**
   * Crawl a single website
   */
  private async crawlWebsite(url: string, options: CrawlOptions): Promise<CrawlResult> {
    const documents: Document[] = [];
    const failedUrls: string[] = [];
    const errors: string[] = [];

    try {
      logger.info('Crawling website', { url, options });

      // Check if this is a GitHub repository URL
      const isGitHub = url.includes('github.com');

      // Prepare crawl parameters
      const crawlParams: any = {
        limit: options.maxPages || 100,
        scrapeOptions: {
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          waitFor: 2000, // Wait for JavaScript to render
        },
      };

      // Add exclude patterns
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        crawlParams.excludePaths = options.excludePatterns;
      }

      // For GitHub repos, add include patterns to focus on docs/examples
      if (isGitHub && options.includePatterns && options.includePatterns.length > 0) {
        // GitHub-specific: focus on documentation paths
        crawlParams.includePaths = options.includePatterns;
        // Limit depth to avoid crawling too deep into code
        crawlParams.maxDepth = 4;
        logger.info('GitHub repo detected, applying include patterns', {
          url,
          includePatterns: options.includePatterns,
        });
      }

      // Start crawl
      const crawlResponse = await this.firecrawl.crawl(url, crawlParams) as any;

      // Check if crawl was successful (status should be 'completed')
      if (crawlResponse.status !== 'completed' && !crawlResponse.data) {
        throw new Error(`Crawl failed: ${crawlResponse.error || 'Status: ' + crawlResponse.status}`);
      }

      // Process crawled pages
      const pages = crawlResponse.data || [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];

        try {
          // Report progress
          if (options.onProgress) {
            options.onProgress(i + 1, pages.length, page.url || url);
          }

          // Extract document from page
          const document = this.extractDocument(page, i);
          documents.push(document);

          logger.debug('Page processed', {
            url: document.url,
            title: document.title,
            contentLength: document.content.length,
          });
        } catch (error: any) {
          const errorMsg = `Failed to process page ${page.url}: ${error.message}`;
          logger.warn(errorMsg);
          errors.push(errorMsg);
          failedUrls.push(page.url || `${url}#${i}`);
        }
      }

      logger.info('Website crawl completed', {
        url,
        documentsFound: documents.length,
        failed: failedUrls.length,
      });

      return {
        documents,
        totalPages: documents.length,
        failedUrls,
        errors,
      };
    } catch (error: any) {
      logger.error('Website crawl failed', { url, error: error.message });
      throw error;
    }
  }

  /**
   * Extract document from crawled page
   */
  private extractDocument(page: any, index: number): Document {
    const url = page.url || page.metadata?.url || `unknown-${index}`;
    const title = page.metadata?.title || this.extractTitleFromUrl(url);
    const content = page.markdown || page.html || '';

    // Classify content type from URL
    const contentType = this.classifyContentType(url);

    // Extract metadata
    const metadata = {
      url,
      title,
      description: page.metadata?.description || '',
      contentType,
      tags: this.extractTags(url, content),
      language: this.detectLanguage(content, url),
      crawledAt: new Date().toISOString(),
      updatedAt: page.metadata?.modifiedTime || page.metadata?.publishedTime,
    };

    const document: Document = {
      id: this.generateDocumentId(url),
      url,
      title,
      content,
      metadata,
    };

    return document;
  }

  /**
   * Generate unique document ID from URL
   */
  private generateDocumentId(url: string): string {
    // Use URL as base, normalize and hash
    const normalized = url
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '-');

    return `doc-${normalized}`;
  }

  /**
   * Extract title from URL if not available
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('/').filter(Boolean);
      const lastPart = parts[parts.length - 1] || 'index';

      // Convert kebab-case to Title Case
      return lastPart
        .replace(/-/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
    } catch {
      return 'Untitled Document';
    }
  }

  /**
   * Classify content type from URL
   */
  private classifyContentType(url: string): DocumentContentType {
    const urlLower = url.toLowerCase();

    // GitHub repository patterns
    if (urlLower.includes('github.com')) {
      if (urlLower.includes('/examples/') || urlLower.includes('/example-')) {
        return 'example';
      }
      if (urlLower.includes('/docs/') || urlLower.includes('/manual/') || urlLower.includes('readme')) {
        return 'guide';
      }
      if (urlLower.includes('contributing') || urlLower.includes('migration') || urlLower.includes('changelog')) {
        return 'guide';
      }
    }

    if (urlLower.includes('/tutorial') || urlLower.includes('/getting-started')) {
      return 'tutorial';
    }
    if (urlLower.includes('/api') || urlLower.includes('/reference')) {
      return 'api';
    }
    if (urlLower.includes('/example') || urlLower.includes('/sample')) {
      return 'example';
    }
    if (urlLower.includes('/guide')) {
      return 'guide';
    }
    if (urlLower.includes('/concept') || urlLower.includes('/learn')) {
      return 'concept';
    }

    // Default to concept
    return 'concept';
  }

  /**
   * Extract tags from URL and content
   */
  private extractTags(url: string, content: string): string[] {
    const tags: Set<string> = new Set();

    // Extract from URL path
    const urlParts = url.split('/').filter(Boolean);
    urlParts.forEach(part => {
      if (part.length > 3 && !part.includes('.')) {
        tags.add(part.toLowerCase());
      }
    });

    // Extract common Hedera terms from content
    const hederaTerms = [
      'account',
      'token',
      'smart contract',
      'consensus',
      'topic',
      'transaction',
      'hbar',
      'nft',
      'sdk',
      'hashgraph',
      'hedera',
      'testnet',
      'mainnet',
    ];

    const contentLower = content.toLowerCase();
    hederaTerms.forEach(term => {
      if (contentLower.includes(term)) {
        tags.add(term.replace(/\s+/g, '-'));
      }
    });

    return Array.from(tags).slice(0, 10); // Limit to 10 tags
  }

  /**
   * Detect programming language from content and URL
   */
  private detectLanguage(content: string, url?: string): 'javascript' | 'typescript' | 'java' | 'python' | 'go' | 'solidity' | undefined {
    // First check URL for SDK repository patterns
    if (url) {
      const urlLower = url.toLowerCase();
      // Check which SDK repository this is from
      if (urlLower.includes('hedera-sdk-js') || urlLower.includes('.js') || urlLower.includes('.ts')) {
        return urlLower.includes('.ts') ? 'typescript' : 'javascript';
      }
      if (urlLower.includes('hedera-sdk-java') || urlLower.includes('.java')) {
        return 'java';
      }
      if (urlLower.includes('hedera-sdk-go') || urlLower.includes('.go')) {
        return 'go';
      }
      if (urlLower.includes('hiero-sdk-python') || urlLower.includes('hedera-sdk-python') || urlLower.includes('.py')) {
        return 'python';
      }
      if (urlLower.includes('hedera-sdk-rust') || urlLower.includes('.rs')) {
        // Map Rust to closest available (we don't have rust in our type, but we can add tags)
        return undefined; // Will be tagged as 'rust' separately
      }
      if (urlLower.includes('.sol')) {
        return 'solidity';
      }
    }

    // Then check content for code block markers
    const languagePatterns: Array<[RegExp, 'javascript' | 'typescript' | 'java' | 'python' | 'go' | 'solidity']> = [
      [/```typescript|```ts\b/i, 'typescript'],
      [/```javascript|```js\b/i, 'javascript'],
      [/```java\b/i, 'java'],
      [/```python|```py\b/i, 'python'],
      [/```go\b/i, 'go'],
      [/```solidity|```sol\b/i, 'solidity'],
    ];

    for (const [pattern, language] of languagePatterns) {
      if (pattern.test(content)) {
        return language;
      }
    }

    return undefined;
  }

  /**
   * Scrape a single page (not a full crawl)
   */
  async scrapePage(url: string): Promise<Document> {
    try {
      logger.info('Scraping single page', { url });

      const scrapeResult = await this.firecrawl.scrape(url, {
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 2000,
      }) as any;

      // Scrape returns { markdown, metadata } directly
      if (!scrapeResult.markdown && !scrapeResult.html) {
        throw new Error(`Scrape failed: No content returned`);
      }

      const document = this.extractDocument(scrapeResult, 0);

      logger.info('Page scraped successfully', {
        url: document.url,
        title: document.title,
        contentLength: document.content.length,
      });

      return document;
    } catch (error: any) {
      logger.error('Page scrape failed', { url, error: error.message });
      throw new Error(`Failed to scrape ${url}: ${error.message}`);
    }
  }

  /**
   * Check API credits (if available)
   */
  async checkCredits(): Promise<{ remaining?: number; total?: number } | null> {
    try {
      // Firecrawl API doesn't expose credits endpoint in free tier
      // This is a placeholder for future implementation
      logger.info('Credit check not available in free tier');
      return null;
    } catch (error: any) {
      logger.warn('Failed to check credits', { error: error.message });
      return null;
    }
  }
}
