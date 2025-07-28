// debugChunking.js - Save this in your project root and run it
import fs from 'fs';
import path from 'path';
import { chunkText } from './src/rag/chunk.js';

console.log('🔍 DEBUGGING CHUNKING ISSUE\n');

// 1. Check if chunk.js has the right content
const chunkPath = './src/rag/chunk.js';
const chunkContent = fs.readFileSync(chunkPath, 'utf-8');

console.log('1. Checking chunk.js content:');
if (chunkContent.includes('MIN_CHUNK_SIZE = 400')) {
  console.log('✅ Found MIN_CHUNK_SIZE = 400');
} else {
  console.log('❌ MIN_CHUNK_SIZE = 400 NOT FOUND!');
}

if (chunkContent.includes('chunk.length >= MIN_CHUNK_SIZE')) {
  console.log('✅ Found MIN_CHUNK_SIZE check');
} else if (chunkContent.includes('chunk.length >= 200')) {
  console.log('❌ Still using old 200 char minimum!');
} else {
  console.log('⚠️  Cannot find chunk size check');
}

// 2. Test with a file that's creating tiny chunks
console.log('\n2. Testing with actual file content:');

const testFiles = [
  'docs/web/clubs-students-or-college-of-agricultural-and-environmental-sciences.md',
  'docs/clubs-students-or-college-of-agricultural-and-environmental-sciences.md',
  'docs/clubs-students-or-college-of-agricultural-and-environmental-sciences.txt',
];

let fileFound = false;
for (const testFile of testFiles) {
  if (fs.existsSync(testFile)) {
    fileFound = true;
    console.log(`\nTesting with: ${testFile}`);
    const content = fs.readFileSync(testFile, 'utf-8');
    console.log(`File length: ${content.length} chars`);
    console.log(
      `First 200 chars: "${content.substring(0, 200).replace(/\n/g, '\\n')}..."`
    );

    // Test chunking
    console.log('\nChunking with maxChars=1200, overlap=200:');
    const chunks = chunkText(content, 1200, 200);

    console.log(`Total chunks created: ${chunks.length}`);

    // Analyze chunks
    const tinyChunks = chunks.filter(c => c.length < 400);
    const goodChunks = chunks.filter(c => c.length >= 400);

    console.log(`Good chunks (400+): ${goodChunks.length}`);
    console.log(`Tiny chunks (<400): ${tinyChunks.length}`);

    if (tinyChunks.length > 0) {
      console.log('\n❌ FOUND TINY CHUNKS:');
      tinyChunks.forEach((chunk, i) => {
        console.log(`  Chunk length ${chunk.length}: "${chunk}"`);
      });
    }

    break;
  }
}

if (!fileFound) {
  console.log('No test files found. Testing with sample text...');
  const sampleText = 'p](#top)\n\nSome content here\n\n(#top)\n\nMore text';
  const chunks = chunkText(sampleText, 1200, 200);
  console.log(`Created ${chunks.length} chunks from sample`);
  chunks.forEach((c, i) => {
    console.log(`  Chunk ${i + 1}: ${c.length} chars - "${c}"`);
  });
}

// 3. Check ingest.js parameters
console.log('\n3. Checking ingest.js parameters:');
const ingestPath = './src/rag/ingest.js';
if (fs.existsSync(ingestPath)) {
  const ingestContent = fs.readFileSync(ingestPath, 'utf-8');

  const maxCharsMatch = ingestContent.match(/const MAX_CHARS = (\d+)/);
  const overlapMatch = ingestContent.match(/const OVERLAP = (\d+)/);

  if (maxCharsMatch) {
    console.log(
      `MAX_CHARS: ${maxCharsMatch[1]} ${
        maxCharsMatch[1] === '1200' ? '✅' : '❌ Should be 1200'
      }`
    );
  }
  if (overlapMatch) {
    console.log(
      `OVERLAP: ${overlapMatch[1]} ${
        overlapMatch[1] === '200' ? '✅' : '❌ Should be 200'
      }`
    );
  }
}

console.log('\n4. DIAGNOSIS:');
if (!chunkContent.includes('MIN_CHUNK_SIZE = 400')) {
  console.log('❌ Your chunk.js does NOT have the updated code!');
  console.log(
    '   You need to replace the entire file with the improved version.'
  );
} else if (tinyChunks && tinyChunks.length > 0) {
  console.log(
    '❌ The chunking logic is not filtering out small chunks properly.'
  );
  console.log('   There may be an issue with the implementation.');
} else {
  console.log('✅ Chunking appears to be working correctly.');
  console.log(
    '   You may need to check if ingest.js is calling chunkText correctly.'
  );
}
