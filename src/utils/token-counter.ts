/**
 * Token Counter Utility
 *
 * Accurate token counting and text splitting using tiktoken.
 * Based on OpenAI's tokenization for text-embedding-3-small model.
 */

import { encoding_for_model, Tiktoken } from 'tiktoken';
import { logger } from './logger.js';

/**
 * Token counter class with caching
 */
export class TokenCounter {
  private encoder: Tiktoken;
  private modelName: string;

  constructor(modelName: string = 'text-embedding-3-small') {
    this.modelName = modelName;
    // Use cl100k_base encoding (used by text-embedding-3-small and GPT-4)
    this.encoder = encoding_for_model('gpt-4');
    logger.debug('TokenCounter initialized', { model: this.modelName });
  }

  /**
   * Count tokens in text
   */
  countTokens(text: string): number {
    try {
      const tokens = this.encoder.encode(text);
      return tokens.length;
    } catch (error: any) {
      logger.error('Token counting failed', { error: error.message });
      // Fallback: rough estimate
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Split text into chunks by token count
   */
  splitByTokens(
    text: string,
    maxTokens: number,
    overlapTokens: number = 0,
  ): string[] {
    try {
      const tokens = this.encoder.encode(text);

      if (tokens.length <= maxTokens) {
        return [text];
      }

      const chunks: string[] = [];
      let startIdx = 0;

      while (startIdx < tokens.length) {
        const endIdx = Math.min(startIdx + maxTokens, tokens.length);
        const chunkTokens = tokens.slice(startIdx, endIdx);
        const chunkBytes = this.encoder.decode(chunkTokens);
        const chunkText = new TextDecoder().decode(chunkBytes);

        chunks.push(chunkText);

        // Move start index forward, accounting for overlap
        startIdx = endIdx - overlapTokens;

        // Prevent infinite loop
        if (startIdx >= tokens.length) break;
      }

      return chunks;
    } catch (error: any) {
      logger.error('Token-based splitting failed', { error: error.message });
      // Fallback: split by character estimate
      return this.fallbackSplit(text, maxTokens, overlapTokens);
    }
  }

  /**
   * Truncate text to maximum token count
   */
  truncateToTokens(text: string, maxTokens: number): string {
    try {
      const tokens = this.encoder.encode(text);

      if (tokens.length <= maxTokens) {
        return text;
      }

      const truncatedTokens = tokens.slice(0, maxTokens);
      const truncatedBytes = this.encoder.decode(truncatedTokens);
      return new TextDecoder().decode(truncatedBytes);
    } catch (error: any) {
      logger.error('Token truncation failed', { error: error.message });
      // Fallback: truncate by character estimate
      const estimatedChars = maxTokens * 4;
      return text.substring(0, estimatedChars);
    }
  }

  /**
   * Split text while respecting semantic boundaries (paragraphs, sentences)
   */
  splitBySemantic(
    text: string,
    maxTokens: number,
    overlapTokens: number = 0,
  ): string[] {
    try {
      // Split by paragraphs first
      const paragraphs = text.split(/\n\n+/);
      const chunks: string[] = [];
      let currentChunk = '';
      let currentTokens = 0;

      for (const paragraph of paragraphs) {
        const paragraphTokens = this.countTokens(paragraph);

        // If single paragraph exceeds max, split it
        if (paragraphTokens > maxTokens) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
            currentTokens = 0;
          }

          // Split large paragraph by tokens
          const subChunks = this.splitByTokens(paragraph, maxTokens, overlapTokens);
          chunks.push(...subChunks);
          continue;
        }

        // Check if adding this paragraph would exceed limit
        if (currentTokens + paragraphTokens > maxTokens && currentChunk) {
          chunks.push(currentChunk.trim());

          // Add overlap from previous chunk
          if (overlapTokens > 0) {
            const overlapText = this.getLastNTokens(currentChunk, overlapTokens);
            currentChunk = overlapText + '\n\n' + paragraph;
            currentTokens = this.countTokens(currentChunk);
          } else {
            currentChunk = paragraph;
            currentTokens = paragraphTokens;
          }
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
          currentTokens += paragraphTokens;
        }
      }

      // Add remaining chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      return chunks.length > 0 ? chunks : [text];
    } catch (error: any) {
      logger.error('Semantic splitting failed', { error: error.message });
      return this.splitByTokens(text, maxTokens, overlapTokens);
    }
  }

  /**
   * Get last N tokens from text
   */
  private getLastNTokens(text: string, n: number): string {
    try {
      const tokens = this.encoder.encode(text);
      if (tokens.length <= n) return text;

      const lastTokens = tokens.slice(-n);
      const lastBytes = this.encoder.decode(lastTokens);
      return new TextDecoder().decode(lastBytes);
    } catch (error: any) {
      // Fallback: return last portion by character estimate
      const estimatedChars = n * 4;
      return text.slice(-estimatedChars);
    }
  }

  /**
   * Fallback split when tiktoken fails
   */
  private fallbackSplit(text: string, maxTokens: number, overlapTokens: number): string[] {
    // Rough estimate: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;
    const chunks: string[] = [];
    let startIdx = 0;

    while (startIdx < text.length) {
      const endIdx = Math.min(startIdx + maxChars, text.length);
      chunks.push(text.substring(startIdx, endIdx));

      startIdx = endIdx - overlapChars;
      if (startIdx >= text.length) break;
    }

    return chunks;
  }

  /**
   * Get token limit for model
   */
  getModelLimit(): number {
    // text-embedding-3-small has 8192 token limit
    return 8192;
  }

  /**
   * Check if text exceeds token limit
   */
  exceedsLimit(text: string, limit?: number): boolean {
    const tokenCount = this.countTokens(text);
    const maxLimit = limit || this.getModelLimit();
    return tokenCount > maxLimit;
  }

  /**
   * Cleanup encoder
   */
  free(): void {
    this.encoder.free();
  }
}

// Singleton instance for global use
let globalTokenCounter: TokenCounter | null = null;

/**
 * Get global token counter instance
 */
export function getTokenCounter(): TokenCounter {
  if (!globalTokenCounter) {
    globalTokenCounter = new TokenCounter();
  }
  return globalTokenCounter;
}

/**
 * Cleanup global token counter
 */
export function cleanupTokenCounter(): void {
  if (globalTokenCounter) {
    globalTokenCounter.free();
    globalTokenCounter = null;
  }
}
