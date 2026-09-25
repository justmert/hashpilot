#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import FirecrawlApp from '@mendable/firecrawl-js';

dotenv.config();

async function testFirecrawl() {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    console.error('FIRECRAWL_API_KEY not set');
    process.exit(1);
  }

  console.log('Testing Firecrawl API...');
  console.log('API Key:', apiKey.substring(0, 10) + '...');
  console.log('');

  try {
    const firecrawl = new FirecrawlApp({ apiKey });

    // Test 1: Scrape a single page
    console.log('Test 1: Scraping a single page...');
    const scrapeResult = await firecrawl.scrape('https://docs.hedera.com', {
      formats: ['markdown'],
    });

    console.log('Scrape result type:', typeof scrapeResult);
    console.log('Scrape result keys:', Object.keys(scrapeResult));
    console.log('Scrape success:', (scrapeResult as any).success);

    if ((scrapeResult as any).success) {
      console.log('✅ Scrape successful!');
      console.log('Data:', (scrapeResult as any).data ? 'present' : 'missing');
      if ((scrapeResult as any).data) {
        console.log('Data keys:', Object.keys((scrapeResult as any).data));
        console.log('Markdown length:', (scrapeResult as any).data.markdown?.length || 0);
      }
    } else {
      console.log('❌ Scrape failed:', (scrapeResult as any).error);
    }

    console.log('');

    // Test 2: Try crawl with limit 1
    console.log('Test 2: Crawling with limit 1...');
    const crawlResult = await firecrawl.crawl('https://docs.hedera.com', {
      limit: 1,
      scrapeOptions: {
        formats: ['markdown'],
      },
    });

    console.log('Crawl result type:', typeof crawlResult);
    console.log('Crawl result keys:', Object.keys(crawlResult));
    console.log('Crawl success:', (crawlResult as any).success);

    if ((crawlResult as any).success) {
      console.log('✅ Crawl successful!');
      console.log('Data:', (crawlResult as any).data ? 'present' : 'missing');
      if ((crawlResult as any).data) {
        console.log('Data is array:', Array.isArray((crawlResult as any).data));
        console.log('Data length:', (crawlResult as any).data.length);
      }
    } else {
      console.log('❌ Crawl failed:', (crawlResult as any).error);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testFirecrawl();
