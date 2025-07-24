// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import OpenAI from 'openai';

import { retrieveRelevantChunks } from './rag/retrieve.js';
import { debugQuery } from './rag/debugQuery.js';

const DEBUG_RAG = process.env.DEBUG_RAG === 'true';
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}
if (!process.env.CHATBOT_API_KEY) {
  console.error('Missing CHATBOT_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const systemPrompt = fs.readFileSync('src/prompts/systemPrompt.txt', 'utf-8');

const app = express();

// --- CORS ---
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://swa34.github.io', // your GitHub Pages
      'https://media-atlanta-horizontal-complexity.trycloudflare.com', // your tunnel
    ],
    credentials: false,
  })
);

app.use(express.json());
app.use(express.static('public'));

// --- Simple API key middleware for /chat & /debug-query ---
function requireApiKey(req, res, next) {
  const headerKey = req.headers['x-api-key'];
  if (!headerKey || headerKey !== process.env.CHATBOT_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Debug RAG route (optional to protect)
app.get('/debug-query', requireApiKey, async (req, res) => {
  try {
    const q = req.query.q || 'test';
    const matches = await debugQuery(q);
    res.json(matches);
  } catch (err) {
    console.error('ERROR /debug-query:', err);
    res.status(500).json({ error: err.message });
  }
});

// Main chat route
app.post('/chat', requireApiKey, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message)
      return res.status(400).json({ error: 'No message provided.' });

    // 1) Retrieve from Pinecone
    const { matches, belowThreshold, topScore } = await retrieveRelevantChunks(
      message
    );

    // Build context text (prefer URL if you stored it in metadata.url)
    const contextText = matches
      .map(
        m =>
          `Source: ${m.metadata.url || m.metadata.source}\n${m.metadata.text}`
      )
      .join('\n\n---\n\n');

    // 2) Build system instructions
    const instructions = systemPrompt.replace(
      '<context>',
      contextText || 'NO CONTEXT FOUND'
    );

    // 3) If below threshold and not debugging, bail early
    if (belowThreshold && !DEBUG_RAG) {
      return res.json({
        answer:
          'I’m here to answer questions about the UGA HFIM program, but I couldn’t find that info in my sources. Could you clarify or ask something else?',
        sources: [],
      });
    }

    // 4) Call OpenAI
    const response = await openai.responses.create({
      model: process.env.GEN_MODEL,
      input: [
        { role: 'system', content: instructions },
        { role: 'user', content: message },
      ],
    });

    const answer = response.output_text;

    // --- DEDUPE SOURCES: clean, deduped URLs sent to the client ---
    const unique = [];
    const seen = new Set();
    for (const m of matches) {
      const u = m.metadata?.url; // <-- real page URL you stored at ingest
      const sourceFile = m.metadata?.source; // original filename (.md, pdf, etc.)
      if (u && !seen.has(u)) {
        seen.add(u);
        unique.push({
          url: u,
          score: m.score,
          sourceFile,
        });
      }
    }
    // --------------------------------------------------------------

    if (DEBUG_RAG) {
      return res.json({
        answer,
        sources: unique, // send them all if you want to inspect
        _topScore: topScore,
        _contextPreview: contextText.slice(0, 1000),
      });
    }

    // Limit to top 3 in prod
    res.json({ answer, sources: unique.slice(0, 3) });
  } catch (err) {
    console.error('ERROR /chat:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
