// src/rag/testImprovements.js - SIMPLIFIED VERSION
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting RAG improvement tests...\n');

// Import with error handling
let chunkText, debugChunkText, retrieveRelevantChunks;

try {
  const chunkModule = await import('./chunk.js');
  chunkText = chunkModule.chunkText;
  debugChunkText = chunkModule.debugChunkText;
  console.log('✅ Successfully imported chunk.js');
} catch (error) {
  console.error('❌ Failed to import chunk.js:', error.message);
  console.log(
    '\nMake sure you have updated chunk.js with the improved version!'
  );
  process.exit(1);
}

try {
  const retrieveModule = await import('./retrieve.js');
  retrieveRelevantChunks = retrieveModule.retrieveRelevantChunks;
  console.log('✅ Successfully imported retrieve.js');
} catch (error) {
  console.error('❌ Failed to import retrieve.js:', error.message);
  process.exit(1);
}

// Set lower threshold for testing
process.env.MIN_SIMILARITY = '0.45';
console.log(`\n📊 Using MIN_SIMILARITY: ${process.env.MIN_SIMILARITY}`);

async function testChunkingImprovements() {
  console.log('\n🧪 TESTING CHUNKING IMPROVEMENTS\n');

  // Find a test file
  const docsDir = path.resolve('docs');
  const webDir = path.join(docsDir, 'web');

  console.log(`Looking for test files in: ${webDir}`);

  if (!fs.existsSync(webDir)) {
    console.log('❌ No docs/web directory found. Looking in docs/ directly...');

    if (!fs.existsSync(docsDir)) {
      console.error('❌ No docs directory found!');
      return;
    }
  }

  // Find any .md file to test with
  const searchDir = fs.existsSync(webDir) ? webDir : docsDir;
  const files = fs.readdirSync(searchDir).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    console.error('❌ No .md files found to test with!');
    return;
  }

  // Test with first file found
  const testFile = path.join(searchDir, files[0]);
  console.log(`\nTesting with: ${files[0]}`);

  try {
    const content = fs.readFileSync(testFile, 'utf-8');
    console.log(`File length: ${content.length} chars`);

    // Simple chunking test
    console.log('\n=== CHUNKING ANALYSIS ===');
    const chunks = chunkText(content, 1200, 200);

    console.log(`Created ${chunks.length} chunks`);

    if (chunks.length > 0) {
      const lengths = chunks.map(c => c.length);
      const avgLength =
        lengths.reduce((sum, len) => sum + len, 0) / chunks.length;
      const minLength = Math.min(...lengths);
      const maxLength = Math.max(...lengths);

      console.log(`\n📊 CHUNK STATISTICS:`);
      console.log(`  Total chunks: ${chunks.length}`);
      console.log(`  Min length: ${minLength} chars`);
      console.log(`  Avg length: ${avgLength.toFixed(0)} chars`);
      console.log(`  Max length: ${maxLength} chars`);

      // Check for tiny chunks
      const tinyChunks = chunks.filter(c => c.length < 400);
      const goodChunks = chunks.filter(c => c.length >= 400);

      console.log(`\n  ✅ Good chunks (400+ chars): ${goodChunks.length}`);
      console.log(`  ❌ Tiny chunks (<400 chars): ${tinyChunks.length}`);

      if (tinyChunks.length > 0) {
        console.log('\n⚠️  Warning: Found tiny chunks!');
        tinyChunks.forEach((chunk, i) => {
          console.log(
            `    - Length ${chunk.length}: "${chunk.substring(0, 50)}..."`
          );
        });
      }

      // Show first chunk as example
      console.log('\n📄 First chunk preview:');
      console.log('─'.repeat(60));
      console.log(chunks[0].substring(0, 200) + '...');
      console.log('─'.repeat(60));
    }
  } catch (error) {
    console.error('❌ Error testing chunking:', error.message);
  }
}

async function testQueryMatching() {
  console.log('\n\n🔍 TESTING QUERY MATCHING\n');

  const testQueries = [
    'how do I schedule a visit',
    'admission requirements HFIM',
    'internship opportunities',
  ];

  console.log('Testing with sample queries...\n');

  for (const query of testQueries) {
    console.log(`Query: "${query}"`);

    try {
      const { matches, belowThreshold, topScore } =
        await retrieveRelevantChunks(query, 5);

      console.log(`  📊 Top Score: ${topScore ? topScore.toFixed(3) : 'N/A'}`);
      console.log(
        `  📍 Status: ${
          belowThreshold ? '❌ Below threshold' : '✅ Above threshold'
        }`
      );
      console.log(`  📄 Matches found: ${matches.length}`);

      if (matches.length > 0 && matches[0].metadata) {
        const source =
          matches[0].metadata.source ||
          matches[0].metadata.sourceFile ||
          'Unknown';
        console.log(`  📎 Top source: ${source}`);
      }

      console.log('');
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}\n`);
    }
  }

  const threshold = Number(process.env.MIN_SIMILARITY || 0.45);
  console.log(`\n💡 Current threshold: ${threshold}`);
  console.log(
    'If many queries are failing, consider lowering the threshold in .env'
  );
}

// Main execution
async function runAllTests() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('COMPREHENSIVE RAG TESTING');
    console.log('='.repeat(60));

    // Check environment
    console.log('\n🔧 Environment Check:');
    console.log(
      `  PINECONE_INDEX_NAME: ${
        process.env.PINECONE_INDEX_NAME || '❌ NOT SET'
      }`
    );
    console.log(
      `  PINECONE_API_KEY: ${
        process.env.PINECONE_API_KEY ? '✅ Set' : '❌ NOT SET'
      }`
    );
    console.log(
      `  OPENAI_API_KEY: ${
        process.env.OPENAI_API_KEY ? '✅ Set' : '❌ NOT SET'
      }`
    );
    console.log(`  EMBED_MODEL: ${process.env.EMBED_MODEL || 'Not specified'}`);

    await testChunkingImprovements();
    await testQueryMatching();

    console.log('\n\n✨ TESTING COMPLETE!');
    console.log('\n📝 Next steps:');
    console.log(
      '1. If you see tiny chunks, replace chunk.js with the improved version'
    );
    console.log('2. Update MIN_SIMILARITY in .env based on your scores');
    console.log('3. Run: npm run ingest -- --purge');
    console.log('4. Test again with: npm run test-improvements');
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error(error.stack);
  }
}

// Make sure the script runs
console.log('Script loaded, running tests...\n');
runAllTests().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
