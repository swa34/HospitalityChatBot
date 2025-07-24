import 'dotenv/config';
import OpenAI from 'openai';
import { getPineconeIndex } from './pineconeClient.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const NAMESPACE = process.env.PINECONE_NAMESPACE || '__default__';

export async function debugQuery(q) {
  const embedRes = await openai.embeddings.create({
    model: process.env.EMBED_MODEL,
    input: q,
  });
  const vector = embedRes.data[0].embedding;

  const index = await getPineconeIndex();
  const ns = index.namespace(NAMESPACE);

  const result = await ns.query({
    vector,
    topK: 5,
    includeMetadata: true,
  });

  return (result.matches ?? []).map(m => ({
    score: m.score,
    source: m.metadata?.source,
    snippet: (m.metadata?.text || '').slice(0, 180) + '...',
  }));
}
