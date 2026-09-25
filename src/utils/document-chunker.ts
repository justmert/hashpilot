/**
 * Document Chunker
 *
 * Semantic-aware document chunking for RAG.
 * Respects document structure (headings, code blocks, lists) and maintains context.
 * Uses token-based counting (tiktoken) for accurate OpenAI compatibility.
 */

import { Document, Chunk, ChunkMetadata, ProgrammingLanguage } from '../types/rag.js';
import { CHUNKING_CONFIG } from '../config/rag.js';
import { getTokenCounter } from './token-counter.js';
import { logger } from './logger.js';
import { stripLoneSurrogates } from './text.js';

/**
 * Section in document structure
 */
interface Section {
  type: 'heading' | 'paragraph' | 'code' | 'list' | 'table';
  level?: number; // For headings (1-6)
  content: string;
  language?: ProgrammingLanguage; // For code blocks
  startIndex: number;
  endIndex: number;
}

/**
 * Document Chunker
 */
export class DocumentChunker {
  private config = CHUNKING_CONFIG;
  private tokenCounter = getTokenCounter();

  /**
   * Chunk a document into smaller pieces
   */
  chunk(document: Document): Chunk[] {
    logger.debug('Chunking document', {
      documentId: document.id,
      contentLength: document.content.length,
    });

    try {
      // Parse document structure
      const sections = this.parseStructure(document.content);

      // Generate chunks from sections
      const chunks = this.chunkSections(sections, document);

      logger.info('Document chunked', {
        documentId: document.id,
        totalChunks: chunks.length,
        averageChunkSize: Math.round(
          chunks.reduce((sum, c) => sum + this.tokenCounter.countTokens(c.text), 0) / chunks.length
        ),
      });

      return chunks;
    } catch (error: any) {
      logger.error('Failed to chunk document', {
        documentId: document.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Parse document structure into sections
   */
  private parseStructure(content: string): Section[] {
    const sections: Section[] = [];
    const lines = content.split('\n');
    let currentIndex = 0;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Check for heading
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        sections.push({
          type: 'heading',
          level,
          content: line,
          startIndex: currentIndex,
          endIndex: currentIndex + line.length,
        });
        currentIndex += line.length + 1;
        i++;
        continue;
      }

      // Check for code block
      if (line.startsWith('```')) {
        const language = this.extractCodeLanguage(line);
        const codeLines: string[] = [line];
        i++;
        currentIndex += line.length + 1;

        // Collect code block content
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          currentIndex += lines[i].length + 1;
          i++;
        }

        // Add closing ```
        if (i < lines.length) {
          codeLines.push(lines[i]);
          currentIndex += lines[i].length + 1;
          i++;
        }

        sections.push({
          type: 'code',
          content: codeLines.join('\n'),
          language,
          startIndex: currentIndex - codeLines.join('\n').length,
          endIndex: currentIndex,
        });
        continue;
      }

      // Check for list item
      if (line.match(/^(\s*[-*+]|\s*\d+\.)\s/)) {
        const listLines: string[] = [line];
        const startIdx = currentIndex;
        currentIndex += line.length + 1;
        i++;

        // Collect consecutive list items
        while (i < lines.length && lines[i].match(/^(\s*[-*+]|\s*\d+\.)\s/)) {
          listLines.push(lines[i]);
          currentIndex += lines[i].length + 1;
          i++;
        }

        sections.push({
          type: 'list',
          content: listLines.join('\n'),
          startIndex: startIdx,
          endIndex: currentIndex,
        });
        continue;
      }

      // Default: paragraph
      if (line.trim().length > 0) {
        const paragraphLines: string[] = [line];
        const startIdx = currentIndex;
        currentIndex += line.length + 1;
        i++;

        // Collect consecutive non-empty lines (until heading, code, or list)
        while (
          i < lines.length &&
          lines[i].trim().length > 0 &&
          !lines[i].startsWith('#') &&
          !lines[i].startsWith('```') &&
          !lines[i].match(/^(\s*[-*+]|\s*\d+\.)\s/)
        ) {
          paragraphLines.push(lines[i]);
          currentIndex += lines[i].length + 1;
          i++;
        }

        sections.push({
          type: 'paragraph',
          content: paragraphLines.join('\n'),
          startIndex: startIdx,
          endIndex: currentIndex,
        });
        continue;
      }

      // Skip empty lines
      currentIndex += line.length + 1;
      i++;
    }

    return sections;
  }

  /**
   * Chunk sections into appropriately sized pieces
   */
  private chunkSections(sections: Section[], document: Document): Chunk[] {
    const chunks: Chunk[] = [];
    let currentChunk: string[] = [];
    let currentSectionPath: string[] = [];
    let currentWordCount = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      // Update section path for headings
      if (section.type === 'heading' && section.level) {
        // Remove deeper levels
        currentSectionPath = currentSectionPath.slice(0, section.level - 1);
        // Add current heading
        const headingText = section.content.replace(/^#+\s*/, '').trim();
        currentSectionPath[section.level - 1] = headingText;
      }

      const sectionTokens = this.tokenCounter.countTokens(section.content);

      // Handle large code blocks
      if (section.type === 'code' && sectionTokens > this.config.maxChunkSize) {
        // Flush current chunk
        if (currentChunk.length > 0) {
          chunks.push(
            this.createChunk(
              currentChunk.join('\n\n'),
              chunkIndex++,
              document,
              currentSectionPath,
              false,
              undefined
            )
          );
          currentChunk = [];
          currentWordCount = 0;
        }

        // Add code block as its own chunk
        chunks.push(
          this.createChunk(
            section.content,
            chunkIndex++,
            document,
            currentSectionPath,
            true,
            section.language ? [section.language] : undefined
          )
        );
        continue;
      }

      // Check if adding this section would exceed max size
      if (currentWordCount + sectionTokens > this.config.maxChunkSize && currentChunk.length > 0) {
        // Create chunk from accumulated content
        chunks.push(
          this.createChunk(
            currentChunk.join('\n\n'),
            chunkIndex++,
            document,
            currentSectionPath,
            currentChunk.some((c) => c.includes('```')),
            this.extractCodeLanguages(currentChunk.join('\n\n'))
          )
        );

        // Start new chunk with overlap
        if (this.config.overlapSize > 0 && currentChunk.length > 0) {
          const overlapText = this.getOverlapText(currentChunk.join('\n\n'));
          currentChunk = overlapText ? [overlapText] : [];
          currentWordCount = overlapText ? this.tokenCounter.countTokens(overlapText) : 0;
        } else {
          currentChunk = [];
          currentWordCount = 0;
        }
      }

      // Add section to current chunk
      currentChunk.push(section.content);
      currentWordCount += sectionTokens;

      // Check if we've reached target size
      if (currentWordCount >= this.config.targetChunkSize) {
        chunks.push(
          this.createChunk(
            currentChunk.join('\n\n'),
            chunkIndex++,
            document,
            currentSectionPath,
            currentChunk.some((c) => c.includes('```')),
            this.extractCodeLanguages(currentChunk.join('\n\n'))
          )
        );

        // Start new chunk with overlap
        if (this.config.overlapSize > 0) {
          const overlapText = this.getOverlapText(currentChunk.join('\n\n'));
          currentChunk = overlapText ? [overlapText] : [];
          currentWordCount = overlapText ? this.tokenCounter.countTokens(overlapText) : 0;
        } else {
          currentChunk = [];
          currentWordCount = 0;
        }
      }
    }

    // Add remaining content as final chunk
    if (currentChunk.length > 0 && currentWordCount >= this.config.minChunkSize) {
      chunks.push(
        this.createChunk(
          currentChunk.join('\n\n'),
          chunkIndex++,
          document,
          currentSectionPath,
          currentChunk.some((c) => c.includes('```')),
          this.extractCodeLanguages(currentChunk.join('\n\n'))
        )
      );
    }

    // Update total chunks count
    return chunks.map((chunk) => ({
      ...chunk,
      totalChunks: chunks.length,
      metadata: {
        ...chunk.metadata,
        totalChunks: chunks.length,
      },
    }));
  }

  /**
   * Create a chunk from text
   */
  private createChunk(
    text: string,
    index: number,
    document: Document,
    sectionPath: string[],
    hasCode: boolean,
    codeLanguages?: ProgrammingLanguage[]
  ): Chunk {
    // Hard limit: max 8000 tokens (model limit is 8192, leave buffer)
    // This prevents any chunk from being too large for embedding
    const tokenCount = this.tokenCounter.countTokens(text);
    if (tokenCount > 8000) {
      text = this.tokenCounter.truncateToTokens(text, 8000);
    }
    const metadata: ChunkMetadata = {
      ...document.metadata,
      documentId: document.id,
      chunkIndex: index,
      totalChunks: 0, // Will be updated later
      sectionPath: sectionPath.join(' > '),
      hasCode,
      codeLanguages,
    };

    return {
      id: `${document.id}-chunk-${index}`,
      documentId: document.id,
      // Scrubbed here so the text that gets embedded is the same text that is
      // stored. Truncated multi-byte characters in fetched source files leave
      // unpaired surrogates, which are not valid JSON for the vector store.
      text: stripLoneSurrogates(text),
      index,
      totalChunks: 0, // Will be updated later
      metadata,
    };
  }

  /**
   * Get overlap text from previous chunk (token-based)
   */
  private getOverlapText(text: string): string {
    const tokenCount = this.tokenCounter.countTokens(text);
    if (tokenCount <= this.config.overlapSize) {
      return text;
    }

    // Take whole trailing lines rather than a proportional character slice.
    // The old slice cut mid-word ("onst txResponse = ...") and mid-code-block,
    // so the following chunk opened with a broken identifier and an unpaired
    // fence, which surfaced as truncated, mislabelled code examples.
    const lines = text.split('\n');
    const selected: string[] = [];
    let tokens = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
      const lineTokens = this.tokenCounter.countTokens(lines[i]);
      if (tokens + lineTokens > this.config.overlapSize && selected.length > 0) {
        break;
      }
      selected.unshift(lines[i]);
      tokens += lineTokens;
    }

    // If the overlap starts inside a fenced block it would carry that block's
    // closing fence without its opener. Re-open the fence so the next chunk is
    // still valid markdown and its language stays detectable.
    const startLine = lines.length - selected.length;
    let insideFence = false;
    let fenceOpener = '';

    for (let i = 0; i < startLine; i++) {
      if (lines[i].startsWith('```')) {
        if (insideFence) {
          insideFence = false;
        } else {
          insideFence = true;
          fenceOpener = lines[i];
        }
      }
    }

    const overlap = selected.join('\n');
    return insideFence ? `${fenceOpener}\n${overlap}` : overlap;
  }

  /**
   * Extract code language from code block opening
   */
  private extractCodeLanguage(line: string): ProgrammingLanguage | undefined {
    const match = line.match(/```(\w+)/);
    if (!match) return undefined;

    const lang = match[1].toLowerCase();

    const languageMap: Record<string, ProgrammingLanguage> = {
      javascript: 'javascript',
      js: 'javascript',
      typescript: 'typescript',
      ts: 'typescript',
      java: 'java',
      python: 'python',
      py: 'python',
      go: 'go',
      golang: 'go',
      solidity: 'solidity',
      sol: 'solidity',
      rust: 'rust',
      rs: 'rust',
    };

    return languageMap[lang];
  }

  /**
   * Extract all code languages from text
   */
  private extractCodeLanguages(text: string): ProgrammingLanguage[] | undefined {
    const languages = new Set<ProgrammingLanguage>();
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('```')) {
        const lang = this.extractCodeLanguage(line);
        if (lang) {
          languages.add(lang);
        }
      }
    }

    return languages.size > 0 ? Array.from(languages) : undefined;
  }
}
