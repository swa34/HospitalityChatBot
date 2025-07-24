// src/rag/chunk.js
export function chunkText(text, maxChars = 1000, overlap = 150) {
  // Normalize whitespace (helps keep chunks consistent)
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    const end = Math.min(start + maxChars, clean.length);
    let chunk = clean.slice(start, end);

    // Try to cut on a sentence boundary
    const lastPeriod = chunk.lastIndexOf('. ');
    if (lastPeriod !== -1 && lastPeriod > overlap && end < clean.length) {
      chunk = chunk.slice(0, lastPeriod + 1);
    }

    chunk = chunk.trim();
    if (chunk.length === 0) {
      // Avoid infinite loop if we somehow got an empty chunk
      start = end;
      continue;
    }

    chunks.push(chunk);

    // Move the window forward
    const increment = Math.max(1, chunk.length - overlap);
    start += increment;
  }

  return chunks;
}
