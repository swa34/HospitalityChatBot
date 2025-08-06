// src/rag/retrieve.js
import 'dotenv/config';
import OpenAI from 'openai';
import { getPineconeIndex } from './pineconeClient.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEBUG_RAG = process.env.DEBUG_RAG === 'true';
const NAMESPACE = process.env.PINECONE_NAMESPACE || '__default__';

export async function retrieveRelevantChunks(userQuestion, topK = 8) {
  // Detect if this is an aggregation query
  const aggregationKeywords = [
    'top',
    'list',
    'all',
    'what internships',
    'past students',
    'examples of',
    'types of',
    'kinds of',
    'where have students',
    'placement',
    'companies',
    'organizations',
  ];

  const questionLower = userQuestion.toLowerCase();
  const isAggregationQuery =
    aggregationKeywords.some(keyword => questionLower.includes(keyword)) &&
    (questionLower.includes('internship') ||
      questionLower.includes('placement'));

  const index = await getPineconeIndex();
  const ns = index.namespace(NAMESPACE);

  if (isAggregationQuery) {
    if (DEBUG_RAG) {
      console.log('--- RAG DEBUG (AGGREGATION MODE) ---');
      console.log('Detected aggregation query:', userQuestion);
    }

    // For aggregation queries, use multiple search strategies
    const searchQueries = [
      userQuestion, // Original query
      'internship report student placement HFIM', // Generic internship query
      'student internship experience company organization', // Broad internship query
      'HFIM hospitality food industry management internship', // Program-specific
      'internship placement location company worked', // Location/company focused
    ];

    const allMatches = [];
    const seenIds = new Set();

    for (const query of searchQueries) {
      const embedRes = await openai.embeddings.create({
        model: process.env.EMBED_MODEL,
        input: query,
      });
      const queryVector = embedRes.data[0].embedding;

      const result = await ns.query({
        vector: queryVector,
        topK: Math.min(topK * 2, 20), // Get more results for each query, but cap at 20
        includeMetadata: true,
      });

      // Add unique matches
      for (const match of result.matches ?? []) {
        if (!seenIds.has(match.id)) {
          seenIds.add(match.id);
          allMatches.push(match);
        }
      }
    }

    // Sort by score and take top results
    const sortedMatches = allMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, topK * 3); // Return more results for aggregation queries

    // Lower threshold for aggregation queries
    const baseThreshold = Number(process.env.MIN_SIMILARITY || 0.75);
    const threshold = baseThreshold * 0.7; // More lenient for aggregation
    const topScore = sortedMatches[0]?.score ?? 0;
    const belowThreshold = sortedMatches.length === 0 || topScore < threshold;

    if (DEBUG_RAG) {
      console.log('Total unique matches found:', sortedMatches.length);
      console.log(
        'Adjusted threshold:',
        threshold,
        '(base:',
        baseThreshold,
        ')'
      );
      console.log('Top score:', topScore);
      console.log(
        'Top matches:',
        sortedMatches.slice(0, 10).map(m => ({
          score: m.score,
          id: m.id,
          source: m.metadata?.sourceFile || m.metadata?.source || 'Unknown',
          textSnippet: m.metadata?.text?.substring(0, 100) + '...' || 'No text',
        }))
      );
      console.log('--- END AGGREGATION DEBUG ---');
    }

    return {
      matches: sortedMatches,
      belowThreshold,
      topScore,
      isAggregation: true, // Flag to help with response formatting
    };
  }

  // Original logic for non-aggregation queries
  const embedRes = await openai.embeddings.create({
    model: process.env.EMBED_MODEL,
    input: userQuestion,
  });
  const queryVector = embedRes.data[0].embedding;

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
        source: m.metadata?.sourceFile || m.metadata?.source || 'Unknown',
        textLength: m.metadata?.text?.length || 0,
        url: m.metadata?.url || 'No URL',
      }))
    );
    console.log('------------------');
  }

  return { matches, belowThreshold, topScore, isAggregation: false };
}
