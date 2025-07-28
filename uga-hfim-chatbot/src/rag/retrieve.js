// src/rag/retrieve.js
import 'dotenv/config';
import OpenAI from 'openai';
import { getPineconeIndex } from './pineconeClient.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEBUG_RAG = process.env.DEBUG_RAG === 'true';
const NAMESPACE = process.env.PINECONE_NAMESPACE || '__default__';

export async function retrieveRelevantChunks(userQuestion, topK = 8) {
  // 1) Embed question
  const embedRes = await openai.embeddings.create({
    model: process.env.EMBED_MODEL,
    input: userQuestion,
  });
  const queryVector = embedRes.data[0].embedding;

  // 2) Query Pinecone namespace
  const index = await getPineconeIndex();
  const ns = index.namespace(NAMESPACE);

  const result = await ns.query({
    vector: queryVector,
    topK,
    includeMetadata: true,
  });

  const matches = result.matches ?? [];
  const threshold = Number(process.env.MIN_SIMILARITY || 0.75);
  const topScore = matches[0]?.score ?? 0;
  const belowThreshold = matches.length === 0 || topScore < threshold;

  if (DEBUG_RAG) {
    console.log('--- RAG DEBUG ---');
    console.log('Question:', userQuestion);
    console.log('topScore:', topScore, 'threshold:', threshold);
    console.log(
      'matches:',
      matches.map(m => ({
        score: m.score,
        id: m.id,
        // Fix: Use sourceFile since that's what your metadata has
        source: m.metadata?.sourceFile || m.metadata?.source || 'Unknown',
        textLength: m.metadata?.text?.length || 0,
        url: m.metadata?.url || 'No URL',
      }))
    );
    console.log('------------------');
  }

  return { matches, belowThreshold, topScore };
}
