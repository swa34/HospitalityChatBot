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
      ' https://irc-northwest-geek-seeking.trycloudflare.com', // your tunnel
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

    // Extract all LinkedIn profiles first
    const allLinkedInProfiles = [];

    // Build context with LinkedIn links preserved
    const contextText = matches
      .map(m => {
        let text = `Source: ${m.metadata.url || m.metadata.sourceFile}\n${
          m.metadata.text
        }`;

        // Extract LinkedIn links from metadata
        if (m.metadata.links) {
          try {
            const links = JSON.parse(m.metadata.links);
            const linkedInLinks = links.filter(l =>
              l.url.includes('linkedin.com')
            );

            // Add to our collection
            linkedInLinks.forEach(link => {
              if (!allLinkedInProfiles.find(p => p.url === link.url)) {
                allLinkedInProfiles.push(link);
              }
            });

            // Include in context text
            if (linkedInLinks.length > 0) {
              text += '\n\nLinkedIn Profiles Found:';
              linkedInLinks.forEach(link => {
                text += `\n- ${link.text || 'Profile'}: ${link.url}`;
              });
            }
          } catch (e) {
            console.error('Error parsing links:', e);
          }
        }

        return text;
      })
      .join('\n\n---\n\n');

    // 2) Enhanced system prompt that emphasizes using actual URLs
    const enhancedSystemPrompt = `${systemPrompt}

CRITICAL: Use ONLY Markdown formatting. NEVER use HTML tags like <a href="">. 

LinkedIn Profile Instructions:
1. When LinkedIn profiles are provided in the context, ALWAYS include them as clickable markdown links
2. Use ONLY this format: [Person's Name](https://www.linkedin.com/in/username)
3. NEVER use HTML anchor tags <a href="...">
4. If you see "LinkedIn Profiles Found:" in the context, use those exact URLs
5. NEVER say "search for them on LinkedIn" if actual URLs are provided
6. Example: If context shows "- Matthew Jones: https://www.linkedin.com/in/matthew-jones-123", 
   write: "You can view [Matthew Jones's LinkedIn profile](https://www.linkedin.com/in/matthew-jones-123)"
   
DO NOT use any HTML tags in your response. Use only plain text and markdown formatting.`;

    const instructions = enhancedSystemPrompt.replace(
      '<context>',
      contextText || 'NO CONTEXT FOUND'
    );

    // 3) If below threshold and not debugging, bail early
    if (belowThreshold && !DEBUG_RAG) {
      return res.json({
        answer:
          "I couldn't find that information in my sources. Could you clarify or ask something else?",
        sources: [],
      });
    }

    // 4) Call OpenAI with enhanced prompt
    const response = await openai.chat.completions.create({
      model: process.env.GEN_MODEL,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: message },
      ],
    });

    let answer = response.choices[0].message.content;

    // 5) Post-process to clean up any HTML and ensure markdown formatting
    // Convert any HTML anchor tags to markdown if they slip through
    answer = answer.replace(
      /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi,
      (match, quote, url, text) => {
        return `[${text}](${url})`;
      }
    );

    // Clean up any escaped HTML entities
    answer = answer
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');

    // Remove any remaining HTML tags that shouldn't be there
    answer = answer.replace(/<(?!\/?(antml:|br|p|div|span)\s*\/?>)[^>]+>/g, '');

    // Ensure LinkedIn URLs are properly formatted as markdown
    allLinkedInProfiles.forEach(profile => {
      const namePattern = new RegExp(
        `(${profile.text}|${profile.text.replace(/\s+/g, '\\s*')})(?!\\]\\()`,
        'gi'
      );

      // Check if the name appears in the answer without being a link
      if (answer.match(namePattern) && !answer.includes(profile.url)) {
        // Replace the first occurrence with a proper link
        answer = answer.replace(namePattern, `[$1](${profile.url})`);
      }
    });

    // --- DEDUPE SOURCES ---
    const unique = [];
    const seen = new Set();

    for (const m of matches) {
      const u = m.metadata?.url;
      const sourceFile = m.metadata?.sourceFile;

      if (u && !seen.has(u)) {
        seen.add(u);
        unique.push({
          url: u,
          score: m.score,
          sourceFile,
        });
      }
    }

    // 6) Include LinkedIn profiles in response if found
    const responseData = {
      answer,
      sources: unique.slice(0, 3),
    };

    // Always include LinkedIn profiles if we found any
    if (allLinkedInProfiles.length > 0) {
      responseData.linkedInProfiles = allLinkedInProfiles;
    }

    res.json(responseData);
  } catch (err) {
    console.error('ERROR /chat:', err);
    res.status(500).json({ error: err.message });
  }
});

// Optional: Add a dedicated endpoint to search for LinkedIn profiles
app.get('/linkedin-search', requireApiKey, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name)
      return res.status(400).json({ error: 'Name parameter required' });

    // Search specifically for LinkedIn profiles
    const { matches } = await retrieveRelevantChunks(
      `LinkedIn profile ${name}`
    );

    const profiles = [];
    for (const match of matches) {
      if (match.metadata.links) {
        try {
          const links = JSON.parse(match.metadata.links);
          const linkedInLinks = links.filter(
            l =>
              l.url.includes('linkedin.com') &&
              (l.text?.toLowerCase().includes(name.toLowerCase()) ||
                match.metadata.text.toLowerCase().includes(name.toLowerCase()))
          );
          profiles.push(...linkedInLinks);
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    // Deduplicate
    const unique = Array.from(new Map(profiles.map(p => [p.url, p])).values());

    res.json({ profiles: unique });
  } catch (err) {
    console.error('ERROR /linkedin-search:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
