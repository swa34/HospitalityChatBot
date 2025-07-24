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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const systemPrompt = fs.readFileSync('src/prompts/systemPrompt.txt', 'utf-8');

// init app first
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// debug route
app.get('/debug-query', async (req, res) => {
  try {
    const q = req.query.q || 'test';
    const matches = await debugQuery(q);
    res.json(matches);
  } catch (err) {
    console.error('ERROR /debug-query:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message)
      return res.status(400).json({ error: 'No message provided.' });

    const { matches, belowThreshold, topScore } = await retrieveRelevantChunks(
      message
    );
    const contextText = matches
      .map(m => `Source: ${m.metadata.source}\n${m.metadata.text}`)
      .join('\n\n---\n\n');

    const instructions = systemPrompt.replace(
      '<context>',
      contextText || 'NO CONTEXT FOUND'
    );

    if (belowThreshold && !DEBUG_RAG) {
      return res.json({
        answer:
          'I’m here to answer questions about the UGA HFIM program, but I couldn’t find that info in my sources. Could you clarify or ask something else?',
      });
    }

    const response = await openai.responses.create({
      model: process.env.GEN_MODEL,
      input: [
        { role: 'system', content: instructions },
        { role: 'user', content: message },
      ],
    });

    const answer = response.output_text;

    if (DEBUG_RAG) {
      return res.json({
        answer,
        _topScore: topScore,
        _contextPreview: contextText.slice(0, 1000),
      });
    }

    res.json({ answer });
  } catch (err) {
    console.error('ERROR /chat:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
