// src/rag/checkDocsAndFix.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('📁 CHECKING DOCUMENT STRUCTURE\n');

// Check all possible locations
const docsDir = path.resolve('docs');
const webDir = path.join(docsDir, 'web');

function scanDirectory(dir, indent = '') {
  if (!fs.existsSync(dir)) {
    console.log(`${indent}❌ Directory not found: ${dir}`);
    return;
  }

  const items = fs.readdirSync(dir);
  const files = items.filter(item => {
    const fullPath = path.join(dir, item);
    return fs.statSync(fullPath).isFile();
  });

  const dirs = items.filter(item => {
    const fullPath = path.join(dir, item);
    return fs.statSync(fullPath).isDirectory();
  });

  // Group files by extension
  const filesByExt = {};
  files.forEach(file => {
    const ext = path.extname(file).toLowerCase();
    if (!filesByExt[ext]) filesByExt[ext] = [];
    filesByExt[ext].push(file);
  });

  // Show summary
  Object.entries(filesByExt).forEach(([ext, fileList]) => {
    console.log(`${indent}${ext || 'no extension'}: ${fileList.length} files`);
    if (fileList.length <= 5) {
      fileList.forEach(f => console.log(`${indent}  - ${f}`));
    } else {
      console.log(`${indent}  - ${fileList[0]}`);
      console.log(`${indent}  - ${fileList[1]}`);
      console.log(`${indent}  - ... and ${fileList.length - 2} more`);
    }
  });

  // Recurse into subdirectories
  dirs.forEach(subdir => {
    console.log(`${indent}📂 ${subdir}/`);
    scanDirectory(path.join(dir, subdir), indent + '  ');
  });
}

console.log('📂 docs/');
scanDirectory(docsDir, '  ');

// Now let's test chunking with whatever files we find
console.log('\n\n🧪 TESTING CHUNKING WITH AVAILABLE FILES\n');

async function testChunkingWithAvailableFiles() {
  // Find any text-based files
  const extensions = ['.txt', '.md'];
  let testFile = null;

  // Look in docs directory and subdirectories
  function findTextFile(dir) {
    if (!fs.existsSync(dir)) return null;

    const items = fs.readdirSync(dir);

    // Check files in current directory
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();
        if (extensions.includes(ext)) {
          return fullPath;
        }
      }
    }

    // Check subdirectories
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const found = findTextFile(fullPath);
        if (found) return found;
      }
    }

    return null;
  }

  testFile = findTextFile(docsDir);

  if (!testFile) {
    console.log('❌ No .txt or .md files found to test chunking!');
    return;
  }

  console.log(`Found test file: ${path.relative(docsDir, testFile)}`);

  try {
    const { chunkText } = await import('./chunk.js');
    const content = fs.readFileSync(testFile, 'utf-8');

    console.log(`\nFile info:`);
    console.log(`  Length: ${content.length} chars`);
    console.log(
      `  First 200 chars: "${content
        .substring(0, 200)
        .replace(/\n/g, '\\n')}..."`
    );

    // Test chunking
    const chunks = chunkText(content, 1200, 200);

    console.log(`\nChunking results:`);
    console.log(`  Total chunks: ${chunks.length}`);

    if (chunks.length > 0) {
      const lengths = chunks.map(c => c.length);
      console.log(`  Min length: ${Math.min(...lengths)} chars`);
      console.log(
        `  Avg length: ${(
          lengths.reduce((a, b) => a + b, 0) / lengths.length
        ).toFixed(0)} chars`
      );
      console.log(`  Max length: ${Math.max(...lengths)} chars`);

      const tinyChunks = chunks.filter(c => c.length < 400);
      if (tinyChunks.length > 0) {
        console.log(
          `\n⚠️  Found ${tinyChunks.length} tiny chunks (<400 chars)!`
        );
        console.log('  You should update chunk.js with the improved version.');
      } else {
        console.log('\n✅ All chunks are appropriately sized!');
      }
    }
  } catch (error) {
    console.error('❌ Error testing chunking:', error.message);
  }
}

// Check if we need to update metadata handling
console.log('\n\n🔧 CHECKING METADATA CONFIGURATION\n');

console.log('The debug output shows "source: undefined" because:');
console.log(
  '1. Your vectors were ingested with metadata.sourceFile (not metadata.source)'
);
console.log('2. The retrieve.js debug is looking for metadata.source\n');

console.log('To fix this, you have two options:\n');
console.log('Option 1: Update retrieve.js to use sourceFile:');
console.log(
  '  source: m.metadata?.sourceFile || m.metadata?.source || "Unknown"\n'
);

console.log('Option 2: Re-ingest with both source and sourceFile in metadata');
console.log('  (Already included in the improved ingest.js)\n');

// Final recommendations based on test results
console.log('\n📊 RECOMMENDATIONS BASED ON YOUR TEST RESULTS:\n');

console.log('1. ✅ Threshold of 0.45 is working well (2/3 queries pass)');
console.log('   - "admission requirements HFIM" scored 0.405 (just below)');
console.log('   - Consider lowering to 0.40 if you want more matches\n');

console.log('2. 📁 Document structure:');
console.log('   - Check the file listing above');
console.log('   - Make sure you have the right files ingested\n');

console.log('3. 🔄 Next steps:');
console.log('   a) Update chunk.js with the improved version');
console.log('   b) Update ingest.js to include both source and sourceFile');
console.log('   c) Run: npm run ingest -- --purge');
console.log('   d) Test again with your chatbot\n');

// Run the chunking test
await testChunkingWithAvailableFiles();
