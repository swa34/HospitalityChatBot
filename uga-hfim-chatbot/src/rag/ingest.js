// src/rag/ingest.js
// Run with:
//   npm run ingest
// Optional flags:
//   npm run ingest -- --dry              # don't upsert, just log
//   npm run ingest -- --recreate-index   # delete & recreate Pinecone index
//   npm run ingest -- --purge            # wipe the current namespace then ingest
//   npm run ingest -- --skip-pdf         # ignore PDFs (use .txt/.md only)
//   node --expose-gc src/rag/ingest.js   # enable manual GC calls if wanted

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import crypto from 'crypto';

import { chunkText } from './chunk.js';

dotenv.config();

// ---------- CONFIG ----------
const BATCH_SIZE = 10; // how many chunks to embed per request
const MAX_CHARS = 1200; // chunk size
const OVERLAP = 200; // overlap between chunks
const INDEX_DIM = 3072; // text-embedding-3-large dimension
const INDEX_METRIC = 'cosine';
const INDEX_CLOUD = 'aws';
const INDEX_REGION = 'us-east-1';

// Keep vectors in a single namespace so we can wipe or query easily.
// Use an env var if you ever need multiple namespaces.
const NAMESPACE = process.env.PINECONE_NAMESPACE || '__default__'; // "" is the SDK default

// ---------- CLI FLAGS ----------
const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry');
const RECREATE_INDEX = flags.has('--recreate-index');
const SKIP_PDF = flags.has('--skip-pdf');
const PURGE = flags.has('--purge');

// ---------- INIT CLIENTS ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// ---------- HELPER: stable chunk ID ----------
function makeChunkId(fileName, chunkIndex) {
  return crypto
    .createHash('sha1')
    .update(`${fileName}|${chunkIndex}`)
    .digest('hex')
    .slice(0, 20); // Pinecone ID max 512 chars; 20 is enough
}

function extractAndEnhanceLinkedInProfiles(text) {
  const profiles = [];

  // Look for LinkedIn URLs
  const urlMatches =
    text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-]+)/gi) ||
    [];
  urlMatches.forEach(url => {
    profiles.push({ url, type: 'direct' });
  });

  // Look for name patterns that suggest LinkedIn profiles
  const namePattern =
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[·•]\s*\d+(?:st|nd|rd|th)\s*[·•]?\s*(?:Connect|Message|Follow)/g;
  let match;
  while ((match = namePattern.exec(text)) !== null) {
    const name = match[1].trim();
    if (!name.match(/University|College|School|Magazine/i)) {
      profiles.push({
        name: name,
        searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
          name
        )}`,
        type: 'pattern',
      });
    }
  }

  // Enhance text with LinkedIn section
  let enhancedText = text;
  if (profiles.length > 0) {
    enhancedText += '\n\n--- LinkedIn Profiles Found ---\n';

    const directUrls = profiles.filter(p => p.type === 'direct');
    if (directUrls.length > 0) {
      enhancedText += '\nDirect LinkedIn URLs:\n';
      directUrls.forEach(p => {
        enhancedText += `• ${p.url}\n`;
      });
    }

    const nameProfiles = profiles.filter(p => p.type === 'pattern');
    const uniqueNames = [...new Set(nameProfiles.map(p => p.name))];
    if (uniqueNames.length > 0) {
      enhancedText += '\nLinkedIn Profile Names (searchable):\n';
      uniqueNames.forEach(name => {
        enhancedText += `• ${name} - Search: https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
          name
        )}\n`;
      });
    }
  }

  return enhancedText;
}

// ---------- HELPER: get/create Pinecone index ----------
async function getOrCreateIndex(indexName) {
  // list indexes (v6 SDK)
  const list = await pinecone.listIndexes();
  const names = list.indexes?.map(i => i.name) || [];

  if (names.includes(indexName)) {
    if (RECREATE_INDEX) {
      console.log(`Index "${indexName}" exists, deleting (RECREATE_INDEX on).`);
      await pinecone.deleteIndex(indexName);
      console.log('Deleted. Recreating.');
    } else {
      console.log(`Index "${indexName}" found.`);
      return pinecone.index(indexName);
    }
  }

  // Create index
  console.log(
    `Creating index "${indexName}" (dim=${INDEX_DIM}, metric=${INDEX_METRIC}).`
  );
  await pinecone.createIndex({
    name: indexName,
    dimension: INDEX_DIM,
    metric: INDEX_METRIC,
    spec: {
      serverless: {
        cloud: INDEX_CLOUD,
        region: INDEX_REGION,
      },
    },
  });

  // Wait until ready
  console.log('Waiting for index to be ready.');
  let ready = false;
  while (!ready) {
    await new Promise(r => setTimeout(r, 4000));
    const d = await pinecone.describeIndex(indexName);
    ready = d.status?.ready;
  }
  console.log(`Index "${indexName}" is ready.`);
  return pinecone.index(indexName);
}

// ---------- HELPER: embed an array of strings ----------
async function embedTexts(texts) {
  const res = await openai.embeddings.create({
    model: process.env.EMBED_MODEL,
    input: texts,
  });
  return res.data.map(d => d.embedding);
}

// ---------- PDF -> TXT conversion helper ----------
function extractSourceUrl(text) {
  const m = text.match(/^Source:\s*(https?:\/\/[^\s]+)$/m);
  return m ? m[1].trim() : null;
}

function ensureTxtFromPdf(fullPdfPath) {
  return path.join(
    path.dirname(fullPdfPath),
    path.basename(fullPdfPath, path.extname(fullPdfPath)) + '.txt'
  );
}

async function pdfToText(fullPdfPath, outTxtPath) {
  const buf = fs.readFileSync(fullPdfPath);
  const { text } = await pdfParse(buf);

  // Enhance with LinkedIn profiles
  const enhancedText = extractAndEnhanceLinkedInProfiles(text);

  fs.writeFileSync(outTxtPath, enhancedText, 'utf8');
  return enhancedText;
}

// ---------- PROCESS ONE FILE ----------
async function processFile(fullPath, fileName, index) {
  let rawText = '';

  try {
    const isPdf = fileName.toLowerCase().endsWith('.pdf');
    const isTxtOrMd = /\.(txt|md)$/i.test(fileName);

    if (isPdf && SKIP_PDF) {
      console.log(`Skipping PDF (flag --skip-pdf): ${fileName}`);
      return;
    }

    if (isPdf) {
      // Convert PDF to TXT (or reuse existing)
      const outTxtPath = ensureTxtFromPdf(fullPath);
      if (fs.existsSync(outTxtPath)) {
        rawText = fs.readFileSync(outTxtPath, 'utf8');
        console.log(
          `Using existing TXT for ${fileName} -> ${path.basename(outTxtPath)}`
        );
      } else {
        console.log(`Converting ${fileName} -> ${path.basename(outTxtPath)}`);
        rawText = await pdfToText(fullPath, outTxtPath);
      }
    } else if (isTxtOrMd) {
      rawText = fs.readFileSync(fullPath, 'utf-8');
    } else {
      console.log(`Skipping unsupported file type: ${fileName}`);
      return;
    }
  } catch (err) {
    console.error(`Failed to read/parse ${fileName}:`, err);
    return;
  }

  const pageUrl = extractSourceUrl(rawText); // may be null
  const chunks = chunkText(rawText, MAX_CHARS, OVERLAP);
  console.log(`File: ${fileName} -> ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(slice);

    const vectors = embeddings.map((emb, idx) => ({
      id: makeChunkId(fileName, i + idx),
      values: emb,
      metadata: {
        source: fileName,
        sourceFile: fileName,
        url: pageUrl || '',
        text: slice[idx],
        chunkIndex: i + idx,
        totalChunks: chunks.length,
      },
    }));

    if (DRY_RUN) {
      console.log(
        `[DRY RUN] Would upsert ${vectors.length} vectors from batch ${
          i / BATCH_SIZE + 1
        }`
      );
    } else {
      await index.upsert(vectors, NAMESPACE); // v6 SDK signature: (vectors, namespace?)
      console.log(
        `  Upserted batch ${i / BATCH_SIZE + 1}/${Math.ceil(
          chunks.length / BATCH_SIZE
        )} from ${fileName}`
      );
    }
  }

  rawText = null;
  if (global.gc) global.gc();
}

// ---------- MAIN ----------
async function ingest() {
  // sanity check env
  if (!process.env.PINECONE_API_KEY) {
    console.error('Missing PINECONE_API_KEY in .env');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }

  const docsDir = path.resolve('docs');
  if (!fs.existsSync(docsDir)) {
    console.error(
      `docs folder not found at ${docsDir}. Create it and add your files.`
    );
    process.exit(1);
  }

  const files = fs.readdirSync(docsDir);
  if (!files.length) {
    console.warn('No files in docs/. Nothing to ingest.');
    process.exit(0);
  }

  // index handle (auto create if needed)
  const index = await getOrCreateIndex(process.env.PINECONE_INDEX_NAME);

  // Optional: purge current namespace before ingest
  if (PURGE) {
    console.log(`Purging namespace "${NAMESPACE}" before ingest …`);
    // await index.delete({ deleteAll: true, namespace: NAMESPACE });
    await index.delete({ deleteAll: true }, NAMESPACE);

    console.log('Namespace cleared.');
  }

  for (const file of files) {
    const full = path.join(docsDir, file);
    await processFile(full, file, index);
  }

  console.log('Ingestion complete.');
}

ingest().catch(err => {
  console.error(err);
  process.exit(1);
});
