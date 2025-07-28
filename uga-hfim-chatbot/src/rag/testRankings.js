// Create: src/rag/testRankings.js
import 'dotenv/config';
import { retrieveRelevantChunks } from './retrieve.js';

async function testQueryRankings() {
  const testQueries = [
    'What are the admission requirements for HFIM?',
    'tuition costs and fees',
    'internship opportunities',
    'course schedule',
    'how do i schedule an visit',
    'completely unrelated random topic',
  ];

  console.log('🔍 TESTING QUERY RANKINGS\n');
  console.log('='.repeat(60));

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query}"`);
    console.log('-'.repeat(40));

    try {
      const { matches, topScore, belowThreshold } =
        await retrieveRelevantChunks(query, 5);

      console.log(`🎯 Top Score: ${topScore.toFixed(3)}`);
      console.log(`📊 Total Matches: ${matches.length}`);
      console.log(
        `⚠️  Below Threshold (0.40): ${belowThreshold ? 'YES' : 'NO'}`
      );

      if (matches.length > 0) {
        console.log('\n🏆 TOP MATCHES:');
        matches.slice(0, 3).forEach((match, i) => {
          console.log(
            `  ${i + 1}. Score: ${match.score.toFixed(3)} | Source: ${
              match.metadata?.source || 'Unknown'
            }`
          );
          console.log(
            `     Preview: "${(match.metadata?.text || '').slice(0, 100)}..."`
          );
        });
      } else {
        console.log('❌ No matches found');
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log('\n' + '='.repeat(60));
  }
}

testQueryRankings();
