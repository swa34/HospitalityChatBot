// src/rag/chunk.js - FIXED VERSION FOR UGA HFIM CHATBOT
export function chunkText(text, maxChars = 1200, overlap = 200) {
  // Clean and normalize text
  const clean = (text || '')
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/\s+/g, ' ') // Multiple spaces → single space
    .replace(/\n\s*\n/g, '\n\n') // Clean paragraph breaks
    .trim();

  // Skip very short content entirely
  if (!clean || clean.length < 100) {
    return [];
  }

  // If content is short enough, return as single chunk
  if (clean.length <= maxChars) {
    return [clean];
  }

  const chunks = [];
  let start = 0;

  // CRITICAL: Minimum viable chunk size - THIS IS THE KEY CHANGE
  const MIN_CHUNK_SIZE = 400;

  // Extract source URL if present (preserve it in chunks)
  const sourceMatch = clean.match(
    /^(#[^\n]+\n+)?Source:\s*(https?:\/\/[^\s\n]+)/
  );
  const sourceHeader = sourceMatch ? sourceMatch[0] : '';

  while (start < clean.length) {
    // Calculate end position
    let end = Math.min(start + maxChars, clean.length);

    // Extract chunk
    let chunk = clean.slice(start, end);

    // If we're not at the end and chunk is substantial, find a good break point
    if (end < clean.length && chunk.length > MIN_CHUNK_SIZE) {
      let bestBreak = -1;
      let breakType = '';

      // Priority 1: Paragraph boundary (double newline)
      const paragraphBreaks = [];
      let pos = chunk.indexOf('\n\n');
      while (pos !== -1) {
        paragraphBreaks.push(pos);
        pos = chunk.indexOf('\n\n', pos + 1);
      }

      // Find the last paragraph break that gives us a decent chunk
      for (let i = paragraphBreaks.length - 1; i >= 0; i--) {
        if (paragraphBreaks[i] > maxChars * 0.5) {
          // At least 50% of max size
          bestBreak = paragraphBreaks[i];
          breakType = 'paragraph';
          break;
        }
      }

      // Priority 2: Sentence boundary
      if (bestBreak === -1) {
        // Look for sentence endings
        const sentenceEnds = [];
        const sentencePattern = /[.!?](?:\s+[A-Z]|\s*$)/g;
        let match;
        while ((match = sentencePattern.exec(chunk)) !== null) {
          sentenceEnds.push(match.index + 1); // Position after punctuation
        }

        // Find the last sentence that gives us a decent chunk
        for (let i = sentenceEnds.length - 1; i >= 0; i--) {
          if (sentenceEnds[i] > maxChars * 0.6) {
            // At least 60% of max size
            bestBreak = sentenceEnds[i];
            breakType = 'sentence';
            break;
          }
        }
      }

      // Priority 3: Line break (single newline)
      if (bestBreak === -1) {
        const lastNewline = chunk.lastIndexOf('\n');
        if (lastNewline > maxChars * 0.7) {
          // At least 70% of max size
          bestBreak = lastNewline;
          breakType = 'line';
        }
      }

      // Priority 4: Word boundary (last resort)
      if (bestBreak === -1) {
        const words = chunk.split(/\s+/);
        if (words.length > 10) {
          // Only if we have enough words
          // Find approximately 80% position
          const targetLength = Math.floor(maxChars * 0.8);
          let currentLength = 0;
          for (let i = 0; i < words.length; i++) {
            currentLength += words[i].length + 1; // +1 for space
            if (currentLength >= targetLength) {
              bestBreak = chunk.lastIndexOf(words[i]) + words[i].length;
              breakType = 'word';
              break;
            }
          }
        }
      }

      // Apply the break if found
      if (bestBreak > MIN_CHUNK_SIZE) {
        chunk = chunk.slice(0, bestBreak).trim();
      }
    }

    // Clean up the chunk
    chunk = chunk.trim();

    // CRITICAL CHECK: Only accept chunks that meet minimum size requirement
    if (chunk.length >= MIN_CHUNK_SIZE) {
      // For chunks after the first, prepend source info if it exists and isn't already there
      if (chunks.length > 0 && sourceHeader && !chunk.startsWith('Source:')) {
        chunk = sourceHeader + '\n\n' + chunk;
      }

      chunks.push(chunk);

      // Calculate next start position with overlap
      const actualLength = chunk.length;
      // Ensure we move forward by at least (actualLength - overlap)
      const minAdvance = Math.max(actualLength - overlap, MIN_CHUNK_SIZE);
      start += minAdvance;
    } else {
      // If chunk is too small, skip it and move forward
      console.log(
        `Skipping tiny chunk of ${chunk.length} chars: "${chunk.substring(
          0,
          50
        )}..."`
      );
      start += MIN_CHUNK_SIZE;
    }

    // Safety check to prevent infinite loops
    if (start >= clean.length - 50) {
      break;
    }
  }

  // Post-processing: Check if we have any very small final chunk that should be merged
  if (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk.length < MIN_CHUNK_SIZE) {
      chunks.pop(); // Remove the small last chunk
      console.log(`Removed small final chunk of ${lastChunk.length} chars`);
    }
  }

  // Final validation: remove any chunks that are still too short or just formatting
  const validChunks = chunks.filter(c => {
    // Must be at least minimum size
    if (c.length < MIN_CHUNK_SIZE) {
      console.log(
        `Filtering out chunk of ${c.length} chars: "${c.substring(0, 50)}..."`
      );
      return false;
    }

    // Must contain actual content (not just URLs or formatting)
    const contentWithoutSource = c.replace(
      /^.*?Source:\s*https?:\/\/[^\s\n]+\n*/i,
      ''
    );
    const hasRealContent = /[a-zA-Z]{10,}/.test(contentWithoutSource); // At least 10 consecutive letters

    if (!hasRealContent) {
      console.log(
        `Filtering out chunk with no real content: "${c.substring(0, 50)}..."`
      );
      return false;
    }

    return true;
  });

  console.log(
    `Chunking complete: ${validChunks.length} valid chunks from ${text.length} chars`
  );
  return validChunks;
}

// Debug function
export function debugChunkText(text, maxChars = 1200, overlap = 200) {
  console.log(`\n=== CHUNKING DEBUG ===`);
  console.log(`Original length: ${text.length} chars`);
  console.log(`Settings: maxChars=${maxChars}, overlap=${overlap}`);

  const chunks = chunkText(text, maxChars, overlap);

  console.log(`\nCreated ${chunks.length} chunks`);

  if (chunks.length > 0) {
    const lengths = chunks.map(c => c.length);
    const avgLength =
      lengths.reduce((sum, len) => sum + len, 0) / chunks.length;
    const minLength = Math.min(...lengths);
    const maxLength = Math.max(...lengths);

    console.log(
      `Length stats: min=${minLength}, avg=${avgLength.toFixed(
        0
      )}, max=${maxLength}`
    );

    chunks.forEach((chunk, i) => {
      console.log(`\n--- Chunk ${i + 1} (${chunk.length} chars) ---`);

      // Show start and end for context
      const preview =
        chunk.length > 200
          ? `START: "${chunk.slice(0, 100)}..."\n   END: "...${chunk.slice(
              -100
            )}"`
          : `FULL: "${chunk}"`;

      console.log(preview);

      // Check for source URL
      if (chunk.includes('Source:')) {
        const sourceMatch = chunk.match(/Source:\s*(https?:\/\/[^\s\n]+)/);
        if (sourceMatch) {
          console.log(`Contains source URL: ${sourceMatch[1]}`);
        }
      }
    });
  } else {
    console.log('WARNING: No chunks created!');
  }

  return chunks;
}
