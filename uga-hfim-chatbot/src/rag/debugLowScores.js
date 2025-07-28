// Create: src/rag/debugLowScores.js
import 'dotenv/config';
import OpenAI from 'openai';
import { getPineconeIndex } from './pineconeClient.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function debugLowScores() {
  try {
    console.log('🔍 DEBUGGING LOW SIMILARITY SCORES\n');

    // Test query
    const testQuery = 'how do I schedule a visit';
    console.log(`Testing query: "${testQuery}"\n`);

    // 1. Check embedding model
    console.log('📊 EMBEDDING MODEL CHECK:');
    console.log(`Using model: ${process.env.EMBED_MODEL}`);

    // 2. Get query embedding
    console.log('\n🎯 CREATING QUERY EMBEDDING...');
    const embedRes = await openai.embeddings.create({
      model: process.env.EMBED_MODEL,
      input: testQuery,
    });
    const queryVector = embedRes.data[0].embedding;
    console.log(`Query vector dimensions: ${queryVector.length}`);
    console.log(
      `First few values: [${queryVector
        .slice(0, 5)
        .map(v => v.toFixed(4))
        .join(', ')}...]`
    );

    // 3. Search Pinecone
    console.log('\n🔍 SEARCHING PINECONE...');
    const index = await getPineconeIndex();
    const ns = index.namespace(process.env.PINECONE_NAMESPACE || '');

    const result = await ns.query({
      vector: queryVector,
      topK: 10,
      includeMetadata: true,
    });

    console.log(`Found ${result.matches?.length || 0} matches`);

    // 4. Analyze top matches
    if (result.matches && result.matches.length > 0) {
      console.log('\n🏆 TOP MATCHES ANALYSIS:');
      console.log('=' * 50);

      result.matches.slice(0, 5).forEach((match, i) => {
        console.log(`\n${i + 1}. MATCH ANALYSIS:`);
        console.log(`   Score: ${match.score.toFixed(6)}`);
        console.log(`   ID: ${match.id}`);
        console.log(
          `   Source: ${
            match.metadata?.source || match.metadata?.sourceFile || 'Unknown'
          }`
        );
        console.log(`   URL: ${match.metadata?.url || 'No URL'}`);
        console.log(
          `   Text length: ${(match.metadata?.text || '').length} chars`
        );
        console.log(
          `   Text preview: "${(match.metadata?.text || '').slice(0, 200)}..."`
        );

        // Check for visit-related keywords
        const text = (match.metadata?.text || '').toLowerCase();
        const visitKeywords = [
          'visit',
          'schedule',
          'tour',
          'campus',
          'appointment',
        ];
        const foundKeywords = visitKeywords.filter(keyword =>
          text.includes(keyword)
        );
        console.log(`   Visit keywords found: [${foundKeywords.join(', ')}]`);
      });
    }

    // 5. Try different query variations
    console.log('\n🔄 TESTING QUERY VARIATIONS:');
    const variations = [
      'schedule a visit',
      'campus visit',
      'tour campus',
      'visit scheduling',
      'Schedule a Visit', // Exact case match
    ];

    for (const variation of variations) {
      const embedRes = await openai.embeddings.create({
        model: process.env.EMBED_MODEL,
        input: variation,
      });

      const result = await ns.query({
        vector: embedRes.data[0].embedding,
        topK: 3,
        includeMetadata: true,
      });

      const topScore = result.matches?.[0]?.score || 0;
      console.log(`   "${variation}" → Top score: ${topScore.toFixed(4)}`);
    }

    // 6. Check a specific record (if we can find one about visits)
    console.log('\n📋 FETCHING SPECIFIC VISIT-RELATED RECORD...');
    try {
      // Try to fetch the record we saw in the Pinecone console
      const specificId = '84603f916853e3fbfaca'; // From your screenshot
      const fetchResult = await ns.fetch([specificId]);

      if (fetchResult.records?.[specificId]) {
        const record = fetchResult.records[specificId];
        console.log('Found specific visit record:');
        console.log(`   ID: ${specificId}`);
        console.log(
          `   Metadata keys: [${Object.keys(record.metadata || {}).join(', ')}]`
        );
        console.log(
          `   Text: "${(record.metadata?.text || '').slice(0, 300)}..."`
        );

        // Manually calculate similarity (this should be high if everything is working)
        const dotProduct = queryVector.reduce(
          (sum, a, i) => sum + a * (record.values?.[i] || 0),
          0
        );
        console.log(
          `   Manual dot product with query: ${dotProduct.toFixed(6)}`
        );
      }
    } catch (err) {
      console.log(`   Could not fetch specific record: ${err.message}`);
    }
  } catch (error) {
    console.error('❌ Debug error:', error);
  }
}

debugLowScores();
