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
  Chunk,
  ProgrammingLanguage,
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
  | 'conceptual' // "what is X", "explain Y"
  | 'how_to' // "how do I", "steps to"
  | 'comparison' // "X vs Y", "difference between"
  | 'troubleshooting' // "error", "not working"
  | 'best_practices' // "recommended", "optimal"
  | 'use_case' // "suitable for", "good for"
  | 'architecture' // "system design", "how does X work internally"
  | 'migration' // "migrate from", "move to"
  | 'security' // "secure", "audit", "vulnerability"
  | 'general'; // default

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
    } = {}
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

      // A question that names a specific proposal or standard ("HIP-904",
      // "HCS-10") must see that document. Embeddings are weak at exact
      // identifiers: asked what HIP-904 changes, retrieval returned HIP-655,
      // HIP-719 and release notes, and never HIP-904 itself, although 53 of its
      // chunks are indexed. Chunks that literally contain the identifier are
      // fetched separately and ranked first.
      const pinned = await this.findIdentifierMatches(query, queryEmbedding, options);
      const seen = new Set(pinned.map((result) => result.chunk.id));
      const merged = [...pinned, ...results.filter((result) => !seen.has(result.chunk.id))].slice(
        0,
        Math.max(options.topK || SEARCH_CONFIG.topK, pinned.length)
      );

      // Include neighbors for context
      const enrichedResults = await this.enrichWithNeighbors(merged);

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
    } = {}
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
          answer:
            "I couldn't find any relevant information in the documentation to answer your question.",
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

      // Extract sources, keeping the best-scoring chunk per page. Several
      // chunks of one document routinely match the same question, and without
      // this the caller is shown the same URL two or three times over.
      const sources = this.dedupeSources(searchResults);

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
    } = {}
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
        const examples = this.extractCodeFromText(result.chunk, result.score, options.language);
        codeExamples.push(...examples);
      }

      // Deduplicate and sort by score
      const uniqueExamples = this.deduplicateCodeExamples(codeExamples);

      // Honour the requested language across the whole result set, but only
      // when it leaves something — a request should never come back empty
      // merely because the fences were unlabelled.
      const requested = this.normalizeLanguage(options.language);
      const matching = requested
        ? uniqueExamples.filter((example) => example.language === requested)
        : [];
      const candidates = matching.length > 0 ? matching : uniqueExamples;

      const sortedExamples = candidates
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
    } = {}
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
    return codeKeywords.some((keyword) => questionLower.includes(keyword));
  }

  /**
   * Extract code blocks from text
   */
  /**
   * Fence labels and file extensions that name a language we can label.
   * Keys are lowercase; anything absent is left alone rather than guessed at.
   */
  private static readonly LANGUAGE_ALIASES: Record<string, ProgrammingLanguage> = {
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    javascript: 'javascript',
    node: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    typescript: 'typescript',
    py: 'python',
    python: 'python',
    go: 'go',
    golang: 'go',
    java: 'java',
    rs: 'rust',
    rust: 'rust',
    sol: 'solidity',
    solidity: 'solidity',
  };

  /** Resolve a fence label or metadata value onto a known language */
  private normalizeLanguage(label?: string): ProgrammingLanguage | undefined {
    if (!label) return undefined;
    return RAGService.LANGUAGE_ALIASES[label.trim().toLowerCase()];
  }

  /**
   * Resolve a language from a source file URL.
   *
   * This is what makes raw SDK example files usable: a chunk of
   * `.../examples/create_token/main.go` carries no markdown fence, so the
   * extension is the only reliable signal that the chunk *is* the code.
   */
  private languageFromUrl(url?: string): ProgrammingLanguage | undefined {
    if (!url) return undefined;
    const path = url.split(/[?#]/)[0];
    const match = path.match(/\.([a-z0-9]+)$/i);
    return this.normalizeLanguage(match?.[1]);
  }

  /** Last path segment of a URL, for use in an explanation line */
  private fileNameFromUrl(url?: string): string {
    if (!url) return 'source file';
    const path = url.split(/[?#]/)[0];
    return path.split('/').filter(Boolean).pop() || path;
  }

  /**
   * Build an explanation for a whole-file code chunk from its leading comments,
   * falling back to naming the file.
   */
  private describeSourceChunk(chunk: Chunk, language: ProgrammingLanguage): string {
    const fileName = this.fileNameFromUrl(chunk.metadata.url);

    // Only the leading comment block. Concatenating every comment in the chunk
    // produced run-on strings that stitched unrelated remarks together.
    const leading: string[] = [];
    for (const line of chunk.text.split('\n').slice(0, 15)) {
      const isComment = /^\s*(\/\/|#|\*|\/\*)/.test(line);
      if (!isComment) {
        if (leading.length > 0) break;
        continue;
      }
      const cleaned = line
        .replace(/^\s*(\/\/+|#+|\*+|\/\*+)\s?/, '')
        .replace(/\*\/\s*$/, '')
        .trim();
      if (cleaned) leading.push(cleaned);
    }

    const description = leading.join(' ').slice(0, 200).trim();

    return description ? `${fileName}: ${description}` : `${language} example from ${fileName}`;
  }

  /**
   * Split chunk text into fenced code blocks.
   *
   * Parsed line by line rather than with a paired-backtick regex, because the
   * indexed markdown breaks every assumption that regex made:
   *   - info strings carry a label after the language (```java Java)
   *   - blocks nest inside four-backtick fences (````)
   *   - chunk overlap can slice mid-block, leaving a stray closing fence with
   *     no opener at the top of a chunk
   *
   * The paired-regex version silently matched from a stray closing fence to the
   * next opening one, returning prose as "code".
   */
  private extractFencedBlocks(
    text: string
  ): Array<{ language?: string; code: string; offset: number }> {
    const lines = text.split('\n');
    const blocks: Array<{ language?: string; code: string; offset: number }> = [];

    interface OpenFence {
      char: string;
      length: number;
      language?: string;
      body: string[];
      offset: number;
    }

    let open: OpenFence | null = null;
    let offset = 0;

    for (const line of lines) {
      const lineOffset = offset;
      offset += line.length + 1;

      const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(\S*)/);
      if (!fence) {
        if (open) open.body.push(line);
        continue;
      }

      const marker = fence[1];
      const info = fence[2] || undefined;
      const started: OpenFence = {
        char: marker[0],
        length: marker.length,
        language: info,
        body: [],
        offset: lineOffset,
      };

      if (open === null) {
        open = started;
        continue;
      }

      if (info && !open.language) {
        // The pending block was opened by a bare fence and we have now hit a
        // labelled one: the bare fence was the tail of a block split across
        // chunks, not an opener. Drop it and start here instead.
        open = started;
        continue;
      }

      if (marker[0] === open.char && marker.length >= open.length && !info) {
        blocks.push({
          language: open.language,
          code: open.body.join('\n').trim(),
          offset: open.offset,
        });
        open = null;
        continue;
      }

      // A shorter or differently-marked fence belongs to the block's contents
      open.body.push(line);
    }

    // A block that opened with a real language but never closed was split by
    // the chunker; its contents are still code. A bare unterminated fence is
    // assumed to be a stray closer and dropped.
    if (open !== null && open.language) {
      blocks.push({
        language: open.language,
        code: open.body.join('\n').trim(),
        offset: open.offset,
      });
    }

    return blocks;
  }

  /**
   * Does this line read as prose rather than code?
   *
   * Used to keep code out of the `explanation` field. Deliberately strict: the
   * cost of dropping a usable sentence is an empty explanation, while the cost
   * of keeping a line of code is an example that appears to be described by
   * source in another language.
   */
  private looksLikeProse(line: string): boolean {
    const trimmed = line.trim();

    if (trimmed.length < 15) return false;
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(trimmed)) return false; // fence
    if (/^[#/]{1,3}\s*\[/.test(trimmed)) return false; // #[derive(...)] attribute macros

    // Headings and list items are prose once their marker is removed
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/.test(trimmed)) {
      const withoutMarker = trimmed.replace(/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/, '').trim();
      return (
        withoutMarker.length >= 15 &&
        withoutMarker.split(/\s+/).length >= 4 &&
        !/[;{}]\s*$/.test(withoutMarker)
      );
    }

    if (
      /^(import|package|use|from|const|let|var|func|fn|def|class|public|private|return|await|async|if|for|while|try|catch|@)\b/.test(
        trimmed
      )
    ) {
      return false;
    }
    if (/[;{}]\s*$/.test(trimmed)) return false; // statement or block punctuation
    if (/^[.)\]}]/.test(trimmed)) return false; // continuation of a chained call
    if (
      /\w+\(|=>|::/.test(trimmed) &&
      !/\s(the|a|an|to|of|for|with|that|this|is|are)\s/i.test(trimmed)
    ) {
      return false;
    }

    // Real prose has spaces between words and at least a few of them
    return trimmed.split(/\s+/).length >= 4;
  }

  /** The last few lines of prose in a passage, or an empty string if none */
  private nearestProse(passage: string, maxLines = 3): string {
    const prose: string[] = [];

    for (const line of passage.split('\n').reverse()) {
      if (this.looksLikeProse(line)) {
        prose.unshift(line.trim());
        if (prose.length === maxLines) break;
      } else if (prose.length > 0) {
        // Stop at the first non-prose line above what we collected
        break;
      }
    }

    return prose.join(' ').trim();
  }

  /**
   * Extract runnable code examples from one retrieved chunk.
   *
   * Two shapes of indexed content carry code, and both have to work:
   *
   *   1. Prose documentation (docs.hedera.com, HIPs, tutorials), where code
   *      lives in ```-fenced blocks inside markdown.
   *   2. Raw SDK example files (`.go`, `.java`, `.py`, `.rs`, `.ts`) indexed
   *      straight from the SDK repositories, where the chunk *is* the code and
   *      no fence exists.
   *
   * Only handling (1) made `docs_get_example` return nothing for every language
   * whose examples are source files rather than prose.
   */
  private extractCodeFromText(
    chunk: Chunk,
    score: number,
    preferredLanguage?: string
  ): CodeExample[] {
    const { text } = chunk;
    const title = chunk.metadata.title;
    const sourceUrl = chunk.metadata.url;
    const preferred = this.normalizeLanguage(preferredLanguage);
    const chunkLanguage = this.normalizeLanguage(chunk.metadata.language);

    const codeExamples: CodeExample[] = [];

    for (const block of this.extractFencedBlocks(text)) {
      // Skip if code is too short
      if (block.code.length < 20) {
        continue;
      }

      // Prefer the fence's own label, keep an unrecognised one verbatim rather
      // than silently relabelling it (a ```bash block is not JavaScript).
      const language = (this.normalizeLanguage(block.language) ||
        (block.language as ProgrammingLanguage | undefined) ||
        chunkLanguage ||
        'javascript') as ProgrammingLanguage;

      // Context for the block: the nearest lines of real prose before it.
      // Taking N raw lines produced "explanations" that were fence markers,
      // Rust attribute macros, or Java source sitting above a Go block on a
      // multi-language page. Anything that does not read as prose is dropped,
      // and no explanation is better than a misleading one.
      const explanation = this.nearestProse(text.substring(0, block.offset));

      codeExamples.push({
        title,
        code: block.code,
        language,
        sourceUrl,
        explanation,
        score: preferred && language === preferred ? score * 1.2 : score,
      });
    }

    if (codeExamples.length === 0) {
      // No fence: treat the chunk as code only when the URL is itself a source
      // file. The chunk's `language` metadata is not enough — a multi-language
      // tutorial page carries one too, and dumping its prose out as "code"
      // would be worse than returning nothing.
      const language = this.languageFromUrl(sourceUrl);
      const code = text.trim();

      if (language && chunk.metadata.hasCode && code.length >= 20) {
        codeExamples.push({
          title,
          code,
          language,
          sourceUrl,
          explanation: this.describeSourceChunk(chunk, language),
          score: preferred && language === preferred ? score * 1.2 : score,
        });
      }
    }

    return codeExamples;
  }

  /**
   * Proposal and standard identifiers named in a query, normalised to the form
   * the documents use ("hip 904" -> "HIP-904").
   */
  static extractSpecIdentifiers(query: string): string[] {
    const found = new Set<string>();
    const pattern = /\b(HIP|HCS)[\s-]?(\d{1,4})\b/gi;
    let match;
    while ((match = pattern.exec(query)) !== null) {
      found.add(`${match[1].toUpperCase()}-${Number(match[2])}`);
    }
    return Array.from(found).slice(0, 3);
  }

  /**
   * Chunks for each proposal or standard the query names.
   *
   * Two lookups per identifier. First the document that *defines* it, and the
   * chunks of that document closest to the question: a HIP never names itself in
   * its body — its only literal marker is the `hip: 904` frontmatter line in the
   * first chunk, which holds nothing but the author list — so matching the text
   * "HIP-904" can never find it. Then up to two other documents that mention the
   * identifier by name, such as release notes. Matching is on the whole
   * identifier, so HCS-1 does not pull in HCS-10.
   */
  private async findIdentifierMatches(
    query: string,
    queryEmbedding: number[],
    options: { filters?: SearchFilters; collectionName?: string }
  ): Promise<SearchResult[]> {
    const pinned: SearchResult[] = [];
    const seen = new Set<string>();
    const add = (results: SearchResult[], limit: number) => {
      for (const result of results) {
        if (limit <= 0) break;
        if (seen.has(result.chunk.id)) continue;
        seen.add(result.chunk.id);
        pinned.push(result);
        limit--;
      }
    };

    for (const identifier of RAGService.extractSpecIdentifiers(query)) {
      const [kind, number] = identifier.split('-');

      try {
        // 1. The defining document
        const probe = kind === 'HIP' ? `hip: ${number}` : identifier;
        const defines =
          kind === 'HIP'
            ? (hit: SearchResult) =>
                new RegExp(`(^|\\n)hip:\\s*${number}\\s*(\\n|$)`).test(hit.chunk.text)
            : (hit: SearchResult) =>
                new RegExp(`/hcs-${number}(\\.md|/)`, 'i').test(hit.chunk.metadata.url);

        const probeHits = await this.chromaService.query(queryEmbedding, {
          nResults: 10,
          collectionName: options.collectionName,
          documentContains: probe,
        });
        const documentId = probeHits.find(defines)?.chunk.documentId;

        if (documentId) {
          const inDocument = await this.chromaService.query(queryEmbedding, {
            nResults: 3,
            collectionName: options.collectionName,
            filters: { ...options.filters, documentId },
          });
          add(inDocument, 3);
        }

        // 2. Other documents that name it
        const mentions = await this.chromaService.query(queryEmbedding, {
          nResults: 10,
          filters: options.filters,
          collectionName: options.collectionName,
          documentContains: identifier,
        });
        const exact = new RegExp(`\\b${identifier}(?!\\d)`, 'i');
        add(
          mentions.filter(
            (hit) => exact.test(hit.chunk.text) && hit.chunk.documentId !== documentId
          ),
          2
        );
      } catch (error: any) {
        // Identifier lookup is an enhancement; plain retrieval still answers
        logger.warn('Identifier lookup failed', { identifier, error: error.message });
      }
    }

    return pinned;
  }

  /**
   * Collapse search results into one source entry per URL, keeping the highest
   * scoring chunk for each.
   */
  private dedupeSources(
    searchResults: SearchResult[]
  ): Array<{ title: string; url: string; excerpt: string; score: number }> {
    const best = new Map<string, SearchResult>();

    for (const result of searchResults) {
      const url = result.chunk.metadata.url;
      const current = best.get(url);
      if (!current || result.score > current.score) {
        best.set(url, result);
      }
    }

    return Array.from(best.values())
      .sort((a, b) => b.score - a.score)
      .map((result) => ({
        title: result.chunk.metadata.title,
        url: result.chunk.metadata.url,
        excerpt: this.extractExcerpt(result.chunk.text, 200),
        score: result.score,
      }));
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
    const additionalTerms = relatedTerms.filter((term) => !queryLower.includes(term)).slice(0, 2);

    if (additionalTerms.length > 0) {
      return `${query} ${additionalTerms.join(' ')}`;
    }

    return query;
  }

  /**
   * Get system prompt tailored to query intent
   */
  getIntentBasedSystemPrompt(
    intent: QueryIntent,
    expertiseLevel: ExpertiseLevel = 'intermediate'
  ): string {
    const basePrompt = QA_CONFIG.systemPrompt;

    const intentInstructions: Record<QueryIntent, string> = {
      conceptual:
        'Focus on clear explanations and definitions. Provide background context and fundamental concepts.',
      how_to:
        'Provide step-by-step instructions with practical examples. Be specific about implementation details.',
      comparison:
        'Objectively compare the options, highlighting pros and cons of each. Include specific use cases for each option.',
      troubleshooting:
        'Focus on diagnosing the issue and providing actionable solutions. Include common causes and debugging steps.',
      best_practices:
        'Emphasize industry best practices, patterns, and recommendations. Explain the reasoning behind each practice.',
      use_case:
        'Analyze suitability for the specific use case. Consider requirements, constraints, and alternatives.',
      architecture:
        'Explain the system design, components, and how they interact. Use diagrams if helpful.',
      migration:
        'Provide migration strategies, potential challenges, and step-by-step transition guides.',
      security:
        'Focus on security implications, potential vulnerabilities, and protective measures. Be thorough about risks.',
      general: 'Provide a comprehensive and balanced answer covering all relevant aspects.',
    };

    const levelInstructions: Record<ExpertiseLevel, string> = {
      beginner:
        'Use simple language and avoid jargon. Explain technical terms when used. Provide more context and examples.',
      intermediate:
        'Assume familiarity with blockchain basics. Balance explanation with technical details.',
      advanced:
        'Use technical terminology freely. Focus on advanced patterns, optimizations, and edge cases.',
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
    } = {}
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
          answer:
            "I couldn't find any relevant information in the Hedera documentation to answer your question. Try rephrasing your question or breaking it down into more specific parts.",
          sources: [],
          hasCodeExamples: false,
          model: this.completionModel,
        };
      }

      // Build context from search results
      const context = this.buildContext(searchResults);

      // Check if question is asking for code examples
      const wantsCodeExample =
        this.detectCodeExampleRequest(question) ||
        (intent === 'how_to' && options.includeCodeExamples !== false);

      // Generate intent-aware system prompt
      const systemPrompt = this.getIntentBasedSystemPrompt(intent, expertiseLevel);

      // Generate answer with custom system prompt
      const answer = await this.generateAnswerWithPrompt(question, context, systemPrompt, {
        includeCodeExamples: options.includeCodeExamples || wantsCodeExample,
        language: options.language,
      });

      // Extract sources, keeping the best-scoring chunk per page. Several
      // chunks of one document routinely match the same question, and without
      // this the caller is shown the same URL two or three times over.
      const sources = this.dedupeSources(searchResults);

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
    } = {}
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
