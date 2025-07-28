// src/rag/verifyChunking.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('🔍 VERIFYING CHUNK.JS STATUS\n');

// Read current chunk.js
const chunkPath = path.join('src', 'rag', 'chunk.js');
const currentContent = fs.readFileSync(chunkPath, 'utf-8');

// Check for signs of the old vs new version
const hasOldMinSize = currentContent.includes('if (chunk.length >= 200)');
const hasNewMinSize = currentContent.includes('const MIN_CHUNK_SIZE = 400');
const hasOldOverlap = currentContent.includes('overlap = 150');
const hasNewOverlap = currentContent.includes('overlap = 200');

console.log('Current chunk.js analysis:');
console.log(
  `  Has old minimum size (200): ${hasOldMinSize ? '❌ YES' : '✅ NO'}`
);
console.log(
  `  Has new minimum size (400): ${hasNewMinSize ? '✅ YES' : '❌ NO'}`
);
console.log(`  Has old overlap (150): ${hasOldOverlap ? '❌ YES' : '✅ NO'}`);
console.log(`  Has new overlap (200): ${hasNewOverlap ? '✅ YES' : '❌ NO'}`);

if (hasOldMinSize || !hasNewMinSize) {
  console.log('\n⚠️  WARNING: You are still using the OLD chunk.js!');
  console.log('This is why you have tiny chunks.\n');

  // Create backup
  const backupPath = chunkPath + '.backup.' + Date.now();
  fs.writeFileSync(backupPath, currentContent);
  console.log(`✅ Created backup: ${backupPath}`);

  console.log('\n📝 To fix this:');
  console.log(
    '1. Replace your chunk.js with the improved version from the artifact'
  );
  console.log('2. Run: npm run ingest -- --purge');
  console.log('3. Test again with: npm run test-rankings');
} else {
  console.log('\n✅ You have the improved chunk.js!');
  console.log('But you may need to re-ingest your documents.');
}

// Test current chunking behavior
console.log('\n\n🧪 TESTING CURRENT CHUNKING BEHAVIOR\n');

const testText = `# Test Document

This is a test paragraph with enough content to see how the chunking behaves. It should create reasonable sized chunks, not tiny fragments. The goal is to maintain semantic meaning while splitting the text appropriately.

This is another paragraph that adds more content. When we chunk this text, we want to see chunks that are at least 400 characters long, with good overlap between them to maintain context.

Final paragraph here to make sure we have enough text for multiple chunks if needed.`;

try {
  // Import current chunk function
  const { chunkText } = await import('./chunk.js');

  const chunks = chunkText(testText, 1200, 200);

  console.log(`Created ${chunks.length} chunks from test text\n`);

  chunks.forEach((chunk, i) => {
    console.log(`Chunk ${i + 1}: ${chunk.length} chars`);
    if (chunk.length < 400) {
      console.log(`  ⚠️  TOO SMALL! Content: "${chunk}"`);
    } else {
      console.log(`  ✅ Good size`);
    }
  });

  const avgSize = chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length;
  console.log(`\nAverage chunk size: ${avgSize.toFixed(0)} chars`);

  if (avgSize < 400) {
    console.log('❌ Average chunk size is too small!');
  } else {
    console.log('✅ Average chunk size is good');
  }
} catch (error) {
  console.error('Error testing chunking:', error.message);
}

// Check if we need to show the ingest parameters
console.log('\n\n📋 CHECKING INGEST PARAMETERS\n');

const ingestPath = path.join('src', 'rag', 'ingest.js');
const ingestContent = fs.readFileSync(ingestPath, 'utf-8');

// Look for MAX_CHARS and OVERLAP settings
const maxCharsMatch = ingestContent.match(/const MAX_CHARS = (\d+)/);
const overlapMatch = ingestContent.match(/const OVERLAP = (\d+)/);

if (maxCharsMatch) {
  console.log(
    `MAX_CHARS: ${maxCharsMatch[1]} ${
      maxCharsMatch[1] >= 1200 ? '✅' : '⚠️  (should be 1200)'
    }`
  );
}
if (overlapMatch) {
  console.log(
    `OVERLAP: ${overlapMatch[1]} ${
      overlapMatch[1] >= 200 ? '✅' : '⚠️  (should be 200)'
    }`
  );
}

console.log('\n\n📊 SUMMARY\n');
console.log('Your tiny chunks problem is caused by:');
console.log('1. Still using the old chunk.js with 200 char minimum');
console.log('2. Need to update to the improved version with 400 char minimum');
console.log('3. After updating, must re-ingest all documents');

console.log('\n✨ Once fixed, your search quality will improve dramatically!');
