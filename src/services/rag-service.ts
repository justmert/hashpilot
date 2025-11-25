/**
 * RAG Service
 *
 * Main service for Retrieval-Augmented Generation functionality.
 * Orchestrates search, retrieval, and Q&A capabilities.
 */

import OpenAI from 'openai';
import { ChromaDBService } from './chromadb-service.js';
import { EmbeddingService } from './embedding-service.js';
import {
  SearchResult,
  SearchFilters,
  QAAnswer,
  CodeExample,
} from '../types/rag.js';
import { QA_CONFIG, SEARCH_CONFIG } from '../config/rag.js';
import { logger } from '../utils/logger.js';

/**
 * RAG Service Configuration
 */
export interface RAGServiceConfig {
  chromaService: ChromaDBService;
  embeddingService: EmbeddingService;
  openai: OpenAI;
  completionModel?: string;
}

/**
 * Query Intent Classification
 */
export type QueryIntent =
  | 'conceptual'      // "what is X", "explain Y"
  | 'how_to'          // "how do I", "steps to"
  | 'comparison'      // "X vs Y", "difference between"
  | 'troubleshooting' // "error", "not working"
  | 'best_practices'  // "recommended", "optimal"
  | 'use_case'        // "suitable for", "good for"
  | 'architecture'    // "system design", "how does X work internally"
  | 'migration'       // "migrate from", "move to"
  | 'security'        // "secure", "audit", "vulnerability"
  | 'general';        // default

/**
 * Expertise Level
 */
export type ExpertiseLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * RAG Service
 */
export class RAGService {
  private chromaService: ChromaDBService;
  private embeddingService: EmbeddingService;
  private openai: OpenAI;
  private completionModel: string;

  constructor(config: RAGServiceConfig) {
    this.chromaService = config.chromaService;
    this.embeddingService = config.embeddingService;
    this.openai = config.openai;
    this.completionModel = config.completionModel || 'gpt-4o-mini';

    logger.info('RAGService initialized', {
      completionModel: this.completionModel,
    });
  }

  /**
   * Search documentation using semantic search
   */
  async search(
    query: string,
    options: {
      topK?: number;
      filters?: SearchFilters;
      collectionName?: string;
    } = {},
  ): Promise<SearchResult[]> {
    const startTime = Date.now();

    try {
      logger.info('Starting documentation search', {
        query,
        topK: options.topK,
        filters: options.filters,
      });

      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateQueryEmbedding(query);

      // Search in ChromaDB
      const results = await this.chromaService.query(queryEmbedding, {
        nResults: options.topK || SEARCH_CONFIG.topK,
        filters: options.filters,
        collectionName: options.collectionName,
      });

      // Include neighbors for context
      const enrichedResults = await this.enrichWithNeighbors(results);

      const executionTime = Date.now() - startTime;

      logger.info('Search completed', {
        query,
        resultsFound: enrichedResults.length,
        executionTime,
      });

      return enrichedResults;
    } catch (error: any) {
      logger.error('Search failed', {
        query,
        error: error.message,
      });
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Answer a question using retrieved documentation context
   */
  async askQuestion(
    question: string,
    options: {
      topK?: number;
      filters?: SearchFilters;
      includeCodeExamples?: boolean;
      language?: string;
    } = {},
  ): Promise<QAAnswer> {
    const startTime = Date.now();

    try {
      logger.info('Processing question', {
        question,
        options,
      });

      // Search for relevant context
      const searchResults = await this.search(question, {
        topK: options.topK || SEARCH_CONFIG.topK,
        filters: options.filters,
      });

      if (searchResults.length === 0) {
        return {
          answer: "I couldn't find any relevant information in the documentation to answer your question.",
          sources: [],
          hasCodeExamples: false,
          model: this.completionModel,
        };
      }

      // Build context from search results
      const context = this.buildContext(searchResults);

      // Check if question is asking for code examples
      const wantsCodeExample = this.detectCodeExampleRequest(question);

      // Generate answer
      const answer = await this.generateAnswer(question, context, {
        includeCodeExamples: options.includeCodeExamples || wantsCodeExample,
        language: options.language,
      });

      // Extract sources
      const sources = searchResults.map(result => ({
        title: result.chunk.metadata.title,
        url: result.chunk.metadata.url,
        excerpt: this.extractExcerpt(result.chunk.text, 200),
        score: result.score,
      }));

      // Detect if answer includes code examples
      const hasCodeExamples = answer.includes('```');

      const executionTime = Date.now() - startTime;

      logger.info('Question answered', {
        question: question.substring(0, 100),
        sourcesUsed: sources.length,
        hasCodeExamples,
        executionTime,
      });

      return {
        answer,
        sources,
        hasCodeExamples,
        model: this.completionModel,
      };
    } catch (error: any) {
      logger.error('Question answering failed', {
        question,
        error: error.message,
      });
      throw new Error(`Failed to answer question: ${error.message}`);
    }
  }

  /**
   * Find code examples based on description
   */
  async findCodeExamples(
    description: string,
    options: {
      language?: string;
      limit?: number;
    } = {},
  ): Promise<CodeExample[]> {
    try {
      logger.info('Finding code examples', {
        description,
        language: options.language,
        limit: options.limit,
      });

      // Search with code-specific filters
      const searchResults = await this.search(description, {
        topK: options.limit || 10,
        filters: {
          hasCode: true,
          language: options.language as any,
        },
      });

      // Extract code examples from results
      const codeExamples: CodeExample[] = [];

      for (const result of searchResults) {
        const examples = this.extractCodeFromText(
          result.chunk.text,
          result.chunk.metadata.title,
          result.chunk.metadata.url,
          result.score,
          options.language,
        );
        codeExamples.push(...examples);
      }

      // Deduplicate and sort by score
      const uniqueExamples = this.deduplicateCodeExamples(codeExamples);
      const sortedExamples = uniqueExamples
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit || 5);

      logger.info('Code examples found', {
        description: description.substring(0, 100),
        examplesFound: sortedExamples.length,
      });

      return sortedExamples;
    } catch (error: any) {
      logger.error('Code example search failed', {
        description,
        error: error.message,
      });
      throw new Error(`Failed to find code examples: ${error.message}`);
    }
  }

  /**
   * Build context from search results
   */
  private buildContext(results: SearchResult[]): string {
    let context = '';
    let currentLength = 0;
    const maxLength = QA_CONFIG.maxContextLength;

    for (const result of results) {
      const chunkText = result.chunk.text;
      const chunkWithMeta = `
Source: ${result.chunk.metadata.title}
URL: ${result.chunk.metadata.url}
Content:
${chunkText}
---
`;

      if (currentLength + chunkWithMeta.length > maxLength) {
        break;
      }

      context += chunkWithMeta;
      currentLength += chunkWithMeta.length;
    }

    return context;
  }

  /**
   * Generate answer using LLM
   */
  private async generateAnswer(
    question: string,
    context: string,
    options: {
      includeCodeExamples?: boolean;
      language?: string;
    } = {},
  ): Promise<string> {
    try {
      // Prepare system prompt
      let systemPrompt = QA_CONFIG.systemPrompt;

      if (options.includeCodeExamples) {
        systemPrompt += '\n\nIMPORTANT: Include relevant code examples in your answer.';
        if (options.language) {
          systemPrompt += ` Prefer ${options.language} examples when available.`;
        }
      }

      // Prepare user prompt
      const userPrompt = QA_CONFIG.userPromptTemplate
        .replace('{context}', context)
        .replace('{question}', question);

      // Generate completion
      const completion = await this.openai.chat.completions.create({
        model: this.completionModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      });

      const answer = completion.choices[0].message.content || '';

      logger.debug('Answer generated', {
        tokensUsed: completion.usage,
        answerLength: answer.length,
      });

      return answer;
    } catch (error: any) {
      logger.error('Answer generation failed', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Enrich search results with neighboring chunks for context
   */
  private async enrichWithNeighbors(results: SearchResult[]): Promise<SearchResult[]> {
    if (!SEARCH_CONFIG.includeNeighbors) {
      return results;
    }

    // For now, return results as-is
    // In future, we could fetch neighboring chunks from ChromaDB
    return results;
  }

  /**
   * Extract excerpt from text
   */
  private extractExcerpt(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    const excerpt = text.substring(0, maxLength);
    const lastSpace = excerpt.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.8) {
      return excerpt.substring(0, lastSpace) + '...';
    }

    return excerpt + '...';
  }

  /**
   * Detect if question is asking for code examples
   */
  private detectCodeExampleRequest(question: string): boolean {
    const codeKeywords = [
      'example',
      'code',
      'snippet',
      'implement',
      'how to',
      'sample',
      'demo',
      'usage',
    ];

    const questionLower = question.toLowerCase();
    return codeKeywords.some(keyword => questionLower.includes(keyword));
  }

  /**
   * Extract code blocks from text
   */
  private extractCodeFromText(
    text: string,
    title: string,
    sourceUrl: string,
    score: number,
    preferredLanguage?: string,
  ): CodeExample[] {
    const codeExamples: CodeExample[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const language = (match[1] || 'javascript') as any;
      const code = match[2].trim();

      // Skip if code is too short
      if (code.length < 20) {
        continue;
      }

      // Extract context (text before code block)
      const textBeforeCode = text.substring(0, match.index);
      const contextLines = textBeforeCode.split('\n').slice(-3);
      const explanation = contextLines.join('\n').trim();

      codeExamples.push({
        title,
        code,
        language,
        sourceUrl,
        explanation,
        score: preferredLanguage && language === preferredLanguage ? score * 1.2 : score,
      });
    }

    return codeExamples;
  }

  /**
   * Deduplicate code examples
   */
  private deduplicateCodeExamples(examples: CodeExample[]): CodeExample[] {
    const seen = new Set<string>();
    const unique: CodeExample[] = [];

    for (const example of examples) {
      // Create a hash of the code
      const hash = this.hashCode(example.code);

      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(example);
      }
    }

    return unique;
  }

  /**
   * Simple string hash
   */
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Classify the intent of a user query
   */
  classifyQueryIntent(query: string): QueryIntent {
    const queryLower = query.toLowerCase();

    // Intent patterns with priority ordering
    const intentPatterns: Array<{ intent: QueryIntent; patterns: RegExp[] }> = [
      {
        intent: 'troubleshooting',
        patterns: [
          /\berror\b/i,
          /\bfail(ed|ing|s)?\b/i,
          /\bnot working\b/i,
          /\bissue\b/i,
          /\bproblem\b/i,
          /\bwhy (did|does|is)\b/i,
          /\bfix(ing)?\b/i,
          /\bdebug(ging)?\b/i,
          /\bcrash(ed|ing)?\b/i,
          /\bbrok(e|en)\b/i,
        ],
      },
      {
        intent: 'comparison',
        patterns: [
          /\bvs\.?\b/i,
          /\bversus\b/i,
          /\bcompare\b/i,
          /\bdifference\s+between\b/i,
          /\bwhich\s+(is\s+)?(better|faster|cheaper)\b/i,
          /\bor\b.*\bshould\s+i\s+use\b/i,
          /\b(hedera|hts|hcs)\s+vs\b/i,
        ],
      },
      {
        intent: 'migration',
        patterns: [
          /\bmigrat(e|ing|ion)\b/i,
          /\bmov(e|ing)\s+(from|to|.*to\s+hedera)\b/i,
          /\btransition\b/i,
          /\bport(ing)?\b/i,
          /\bfrom\s+(ethereum|solana|polygon)\s+to\s+hedera\b/i,
          /\bto\s+hedera\s+(token|network|service)\b/i,
        ],
      },
      {
        intent: 'security',
        patterns: [
          /\bsecur(e|ity)\b/i,
          /\baudit(ing)?\b/i,
          /\bvulnerabil(ity|ities)\b/i,
          /\battack\b/i,
          /\bexploit\b/i,
          /\bsafe(ty|ly)?\b/i,
          /\bprotect\b/i,
          /\bencrypt(ion)?\b/i,
        ],
      },
      {
        intent: 'best_practices',
        patterns: [
          /\bbest\s+practices?\b/i,
          /\brecommend(ed|ation)?\b/i,
          /\boptimal\b/i,
          /\boptimiz(e|ation)\b/i,
          /\befficient\b/i,
          /\bshould\s+i\b/i,
          /\bpattern\b/i,
          /\bidiomatic\b/i,
        ],
      },
      {
        intent: 'use_case',
        patterns: [
          /\bsuitable\s+(for|to)\b/i,
          /\bgood\s+(for|choice)\b/i,
          /\bcan\s+(i|we)\s+use\b/i,
          /\bfit\s+(for|my)\b/i,
          /\buse\s+cases?\b/i,
          /\bapplicable\b/i,
          /\bappropriate\b/i,
        ],
      },
      {
        intent: 'architecture',
        patterns: [
          /\barchitecture\b/i,
          /\bdesign\b/i,
          /\binternally\b/i,
          /\bunder\s+the\s+hood\b/i,
          /\bhow\s+does\s+.*\s+work\b/i,
          /\bstructure\b/i,
          /\bcomponent(s)?\b/i,
          /\bsystem\b/i,
        ],
      },
      {
        intent: 'how_to',
        patterns: [
          /\bhow\s+(do|to|can)\b/i,
          /\bsteps?\s+to\b/i,
          /\bguide\s+(to|for)\b/i,
          /\btutorial\b/i,
          /\bwalkthrough\b/i,
          /\bimplement\b/i,
          /\bcreate\s+a?\b/i,
          /\bset\s*up\b/i,
          /\bconfigure\b/i,
        ],
      },
      {
        intent: 'conceptual',
        patterns: [
          /\bwhat\s+is\b/i,
          /\bwhat\s+are\b/i,
          /\bexplain\b/i,
          /\bdefin(e|ition)\b/i,
          /\bunderstand\b/i,
          /\bconcept\b/i,
          /\bmeaning\s+of\b/i,
          /\bwhat\s+does\s+.*\s+mean\b/i,
          /\btell\s+me\s+about\b/i,
        ],
      },
    ];

    // Check patterns in order
    for (const { intent, patterns } of intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(queryLower)) {
          logger.debug('Query intent classified', { query: query.substring(0, 100), intent });
          return intent;
        }
      }
    }

    return 'general';
  }

  /**
   * Expand query with related terms based on intent
   */
  expandQueryByIntent(query: string, intent: QueryIntent): string {
    const expansions: Record<QueryIntent, string[]> = {
      conceptual: ['definition', 'explanation', 'overview', 'introduction'],
      how_to: ['guide', 'tutorial', 'steps', 'example', 'implementation'],
      comparison: ['difference', 'advantage', 'disadvantage', 'versus', 'compare'],
      troubleshooting: ['error', 'solution', 'fix', 'debug', 'issue'],
      best_practices: ['recommendation', 'optimal', 'pattern', 'guidelines'],
      use_case: ['application', 'scenario', 'suitable', 'appropriate'],
      architecture: ['design', 'structure', 'internal', 'component', 'system'],
      migration: ['migrate', 'transition', 'port', 'convert', 'move'],
      security: ['secure', 'safety', 'protection', 'audit', 'vulnerability'],
      general: [],
    };

    const relatedTerms = expansions[intent];
    if (relatedTerms.length === 0) {
      return query;
    }

    // Add relevant terms that aren't already in the query
    const queryLower = query.toLowerCase();
    const additionalTerms = relatedTerms
      .filter(term => !queryLower.includes(term))
      .slice(0, 2);

    if (additionalTerms.length > 0) {
      return `${query} ${additionalTerms.join(' ')}`;
    }

    return query;
  }

  /**
   * Get system prompt tailored to query intent
   */
  getIntentBasedSystemPrompt(intent: QueryIntent, expertiseLevel: ExpertiseLevel = 'intermediate'): string {
    const basePrompt = QA_CONFIG.systemPrompt;

    const intentInstructions: Record<QueryIntent, string> = {
      conceptual: 'Focus on clear explanations and definitions. Provide background context and fundamental concepts.',
      how_to: 'Provide step-by-step instructions with practical examples. Be specific about implementation details.',
      comparison: 'Objectively compare the options, highlighting pros and cons of each. Include specific use cases for each option.',
      troubleshooting: 'Focus on diagnosing the issue and providing actionable solutions. Include common causes and debugging steps.',
      best_practices: 'Emphasize industry best practices, patterns, and recommendations. Explain the reasoning behind each practice.',
      use_case: 'Analyze suitability for the specific use case. Consider requirements, constraints, and alternatives.',
      architecture: 'Explain the system design, components, and how they interact. Use diagrams if helpful.',
      migration: 'Provide migration strategies, potential challenges, and step-by-step transition guides.',
      security: 'Focus on security implications, potential vulnerabilities, and protective measures. Be thorough about risks.',
      general: 'Provide a comprehensive and balanced answer covering all relevant aspects.',
    };

    const levelInstructions: Record<ExpertiseLevel, string> = {
      beginner: 'Use simple language and avoid jargon. Explain technical terms when used. Provide more context and examples.',
      intermediate: 'Assume familiarity with blockchain basics. Balance explanation with technical details.',
      advanced: 'Use technical terminology freely. Focus on advanced patterns, optimizations, and edge cases.',
    };

    return `${basePrompt}

QUERY INTENT: ${intent.toUpperCase()}
${intentInstructions[intent]}

USER EXPERTISE LEVEL: ${expertiseLevel.toUpperCase()}
${levelInstructions[expertiseLevel]}`;
  }

  /**
   * Enhanced question answering with intent awareness
   */
  async askQuestionWithIntent(
    question: string,
    options: {
      topK?: number;
      filters?: SearchFilters;
      includeCodeExamples?: boolean;
      language?: string;
      queryIntent?: QueryIntent;
      expertiseLevel?: ExpertiseLevel;
    } = {},
  ): Promise<QAAnswer> {
    const startTime = Date.now();

    try {
      // Auto-detect intent if not provided
      const intent = options.queryIntent || this.classifyQueryIntent(question);
      const expertiseLevel = options.expertiseLevel || 'intermediate';

      logger.info('Processing question with intent', {
        question: question.substring(0, 100),
        intent,
        expertiseLevel,
      });

      // Expand query based on intent
      const expandedQuery = this.expandQueryByIntent(question, intent);

      // Search for relevant context
      const searchResults = await this.search(expandedQuery, {
        topK: options.topK || SEARCH_CONFIG.topK,
        filters: options.filters,
      });

      if (searchResults.length === 0) {
        return {
          answer: "I couldn't find any relevant information in the Hedera documentation to answer your question. Try rephrasing your question or breaking it down into more specific parts.",
          sources: [],
          hasCodeExamples: false,
          model: this.completionModel,
        };
      }

      // Build context from search results
      const context = this.buildContext(searchResults);

      // Check if question is asking for code examples
      const wantsCodeExample = this.detectCodeExampleRequest(question) ||
                               (intent === 'how_to' && options.includeCodeExamples !== false);

      // Generate intent-aware system prompt
      const systemPrompt = this.getIntentBasedSystemPrompt(intent, expertiseLevel);

      // Generate answer with custom system prompt
      const answer = await this.generateAnswerWithPrompt(question, context, systemPrompt, {
        includeCodeExamples: options.includeCodeExamples || wantsCodeExample,
        language: options.language,
      });

      // Extract sources
      const sources = searchResults.map(result => ({
        title: result.chunk.metadata.title,
        url: result.chunk.metadata.url,
        excerpt: this.extractExcerpt(result.chunk.text, 200),
        score: result.score,
      }));

      // Detect if answer includes code examples
      const hasCodeExamples = answer.includes('```');

      const executionTime = Date.now() - startTime;

      logger.info('Intent-aware question answered', {
        question: question.substring(0, 100),
        intent,
        expertiseLevel,
        sourcesUsed: sources.length,
        hasCodeExamples,
        executionTime,
      });

      return {
        answer,
        sources,
        hasCodeExamples,
        model: this.completionModel,
      };
    } catch (error: any) {
      logger.error('Intent-aware question answering failed', {
        question,
        error: error.message,
      });
      throw new Error(`Failed to answer question: ${error.message}`);
    }
  }

  /**
   * Generate answer with custom system prompt
   */
  private async generateAnswerWithPrompt(
    question: string,
    context: string,
    systemPrompt: string,
    options: {
      includeCodeExamples?: boolean;
      language?: string;
    } = {},
  ): Promise<string> {
    try {
      let finalSystemPrompt = systemPrompt;

      if (options.includeCodeExamples) {
        finalSystemPrompt += '\n\nIMPORTANT: Include relevant code examples in your answer.';
        if (options.language) {
          finalSystemPrompt += ` Prefer ${options.language} examples when available.`;
        }
      }

      // Prepare user prompt
      const userPrompt = QA_CONFIG.userPromptTemplate
        .replace('{context}', context)
        .replace('{question}', question);

      // Generate completion
      const completion = await this.openai.chat.completions.create({
        model: this.completionModel,
        messages: [
          { role: 'system', content: finalSystemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1500, // Increased for more comprehensive answers
      });

      const answer = completion.choices[0].message.content || '';

      logger.debug('Intent-aware answer generated', {
        tokensUsed: completion.usage,
        answerLength: answer.length,
      });

      return answer;
    } catch (error: any) {
      logger.error('Answer generation with prompt failed', {
        error: error.message,
      });
      throw error;
    }
  }
}
