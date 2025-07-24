// src/rag/ingest.js
// Run with:
//   npm run ingest
// Optional flags:
//   npm run ingest -- --dry            # don't upsert, just log
//   npm run ingest -- --recreate-index # delete & recreate Pinecone index
//   npm run ingest -- --skip-pdf       # ignore PDFs (use .txt/.md only)
//   node --expose-gc src/rag/ingest.js # enable manual GC calls if wanted

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { chunkText } from './chunk.js';

dotenv.config();

// ---------- CONFIG ----------
const BATCH_SIZE = 10; // how many chunks to embed per request
const MAX_CHARS = 1000; // chunk size
const OVERLAP = 150; // overlap between chunks
const INDEX_DIM = 3072; // text-embedding-3-large dimension
const INDEX_METRIC = 'cosine';
const INDEX_CLOUD = 'aws';
const INDEX_REGION = 'us-east-1';

// CLI flags
const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry');
const RECREATE_INDEX = flags.has('--recreate-index');
const SKIP_PDF = flags.has('--skip-pdf');

// ---------- INIT CLIENTS ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// ---------- HELPER: get/create Pinecone index ----------
async function getOrCreateIndex(indexName) {
  // list indexes (v6 SDK)
  const list = await pinecone.listIndexes();
  const names = list.indexes?.map(i => i.name) || [];

  if (names.includes(indexName)) {
    if (RECREATE_INDEX) {
      console.log(
        `Index "${indexName}" exists, deleting (RECREATE_INDEX on)...`
      );
      await pinecone.deleteIndex(indexName);
      console.log('Deleted. Recreating...');
    } else {
      console.log(`Index "${indexName}" found.`);
      return pinecone.index(indexName);
    }
  }

  // Create index
  console.log(
    `Creating index "${indexName}" (dim=${INDEX_DIM}, metric=${INDEX_METRIC})...`
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
  console.log('Waiting for index to be ready...');
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

// ---------- PDF -> TXT conversion (optional but nice) ----------
function ensureTxtFromPdf(fullPdfPath) {
  const txtPath = path.join(
    path.dirname(fullPdfPath),
    path.basename(fullPdfPath, path.extname(fullPdfPath)) + '.txt'
  );
  return txtPath;
}

// Convert a single PDF to txt (returns the raw text)
async function pdfToText(fullPdfPath, outTxtPath) {
  const buf = fs.readFileSync(fullPdfPath);
  const { text } = await pdfParse(buf);
  fs.writeFileSync(outTxtPath, text, 'utf8');
  return text;
}

// ---------- PROCESS ONE FILE ----------
async function processFile(fullPath, fileName, idCounterRef, index) {
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

  const chunks = chunkText(rawText, MAX_CHARS, OVERLAP);
  console.log(`File: ${fileName} -> ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(slice);

    const upsertBatch = embeddings.map((emb, idx) => ({
      id: `doc-${idCounterRef.value++}`,
      values: emb,
      metadata: { source: fileName, text: slice[idx] },
    }));

    if (DRY_RUN) {
      console.log(
        `[DRY RUN] Would upsert ${upsertBatch.length} vectors from batch ${
          i / BATCH_SIZE + 1
        }`
      );
    } else {
      await index.upsert(upsertBatch);
      console.log(
        `  Upserted batch ${i / BATCH_SIZE + 1}/${Math.ceil(
          chunks.length / BATCH_SIZE
        )} from ${fileName}`
      );
    }
  }

  // help GC
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

  const idCounterRef = { value: 1 };

  for (const file of files) {
    const full = path.join(docsDir, file);
    await processFile(full, file, idCounterRef, index);
  }

  console.log('Ingestion complete.');
}

ingest().catch(err => {
  console.error(err);
  process.exit(1);
});
