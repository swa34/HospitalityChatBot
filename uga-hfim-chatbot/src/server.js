// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

import { retrieveRelevantChunks } from './rag/retrieve.js';
import { debugQuery } from './rag/debugQuery.js';

const DEBUG_RAG = process.env.DEBUG_RAG === 'true';
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Validate required environment variables
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'CHATBOT_API_KEY',
  'PINECONE_API_KEY',
  'PINECONE_INDEX_NAME',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load system prompt
let systemPrompt;
try {
  systemPrompt = fs.readFileSync('src/prompts/systemPrompt.txt', 'utf-8');
} catch (error) {
  console.error('Failed to load system prompt:', error.message);
  process.exit(1);
}

const app = express();

// Trust proxy (important for Sevalla)
app.set('trust proxy', 1);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
  });
});

// CORS configuration for production
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://swa34.github.io', // your GitHub Pages
];

// Add your Sevalla domain when you get it
if (process.env.SEVALLA_DOMAIN) {
  allowedOrigins.push(`https://${process.env.SEVALLA_DOMAIN}`);
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log('Blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: false,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- Simple API key middleware for /chat & /debug-query ---
function requireApiKey(req, res, next) {
  const headerKey = req.headers['x-api-key'];
  if (!headerKey || headerKey !== process.env.CHATBOT_API_KEY) {
    console.log('Unauthorized access attempt:', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Debug RAG route (optional to protect)
app.get('/debug-query', requireApiKey, async (req, res) => {
  try {
    const q = req.query.q || 'test';
    console.log('Debug query:', q);
    const matches = await debugQuery(q);
    res.json({
      query: q,
      matches,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('ERROR /debug-query:', err);
    res.status(500).json({
      error: 'Debug query failed',
      message:
        NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});

// Main chat route with aggregation support
app.post('/chat', requireApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'No message provided.' });
    }

    console.log('Chat request:', {
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // 1) Retrieve from Pinecone with aggregation support
    const { matches, belowThreshold, topScore, isAggregation } =
      await retrieveRelevantChunks(message);

    // Extract all LinkedIn profiles first
    const allLinkedInProfiles = [];

    // For aggregation queries, also extract internship information
    const internshipInfo = new Map();

    // Build context with enhanced formatting for aggregation queries
    let contextText = '';

    if (isAggregation && matches.length > 0) {
      // For aggregation queries, organize information by internship
      matches.forEach(m => {
        const text = m.metadata.text || '';
        const source = m.metadata.sourceFile || m.metadata.source || 'Unknown';

        // Extract LinkedIn profiles
        if (m.metadata.links) {
          try {
            const links = JSON.parse(m.metadata.links);
            const linkedInLinks = links.filter(l =>
              l.url.includes('linkedin.com')
            );
            linkedInLinks.forEach(link => {
              if (!allLinkedInProfiles.find(p => p.url === link.url)) {
                allLinkedInProfiles.push(link);
              }
            });
          } catch (e) {
            console.error('Error parsing links:', e);
          }
        }

        // Try to extract internship information from the text
        const patterns = [
          /^(.+?)\n(.+?)\nReport/m,
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+).*?(?:Athens Chick-fil-A|UGA Grady|Chick-fil-A|Grady College)/,
          /(?:internship|working|worked|position|role) (?:at|with|for) ([A-Z][A-Za-z\s&\-']+?)(?:\.|,|\n)/,
        ];

        patterns.forEach(pattern => {
          const match = text.match(pattern);
          if (match) {
            const studentName = match[1]?.trim();
            const organization = match[2]?.trim() || match[1]?.trim();

            if (studentName && !internshipInfo.has(studentName)) {
              internshipInfo.set(studentName, {
                organization: organization,
                text: text.substring(0, 500),
                source: source,
                score: m.score,
              });
            }
          }
        });
      });

      // Build structured context for aggregation
      contextText = 'INTERNSHIP INFORMATION FOUND:\n\n';
      let count = 1;

      internshipInfo.forEach((info, studentName) => {
        contextText += `${count}. ${studentName}`;
        if (info.organization && info.organization !== studentName) {
          contextText += ` - ${info.organization}`;
        }
        contextText += `\n   Source: ${info.source}\n`;
        contextText += `   Details: ${info.text
          .replace(/\n/g, ' ')
          .substring(0, 200)}...\n`;

        // Check if this student has a LinkedIn profile
        const studentLinkedIn = allLinkedInProfiles.find(p =>
          p.text
            ?.toLowerCase()
            .includes(studentName.toLowerCase().split(' ')[0])
        );
        if (studentLinkedIn) {
          contextText += `   LinkedIn: ${studentLinkedIn.url}\n`;
        }

        contextText += '\n';
        count++;
      });

      // Also include some raw context
      contextText += '\n\nADDITIONAL CONTEXT:\n\n';
      contextText += matches
        .slice(0, 3)
        .map(
          m =>
            `Source: ${
              m.metadata.url || m.metadata.sourceFile
            }\n${m.metadata.text.substring(0, 300)}...`
        )
        .join('\n\n---\n\n');
    } else {
      // Original context building for non-aggregation queries
      contextText = matches
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
    }

    // 2) Enhanced system prompt with aggregation instructions
    const enhancedSystemPrompt = `${systemPrompt}

CRITICAL: Use ONLY Markdown formatting. NEVER use HTML tags like <a href="">. 

${
  isAggregation
    ? `
SPECIAL INSTRUCTIONS FOR THIS AGGREGATION QUERY:
The user is asking for a list or collection of internships. Look through ALL the context provided and:
1. Extract all student names and their internship organizations
2. Present them in a clear, numbered list format
3. Include LinkedIn profiles when available
4. If you can't find exactly what's requested (e.g., "top 10"), provide what you DO find

Format your response like:
"Based on the information available, I found these HFIM student internship examples:

1. **Student Name** - Organization Name
   [LinkedIn Profile](url) (if available)
   
2. **Another Student** - Their Organization
   
...

Note: This list represents the internships I could find in my current database. For a complete list of all HFIM internship placements, please contact the program office directly."
`
    : ''
}

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

    // 3) If below threshold, provide appropriate response
    if (belowThreshold && !DEBUG_RAG) {
      if (isAggregation) {
        return res.json({
          answer:
            "I couldn't find specific internship examples in my current database. The HFIM program offers various internship opportunities in hospitality, food service, event management, and related industries. For a complete list of internship placements and opportunities, I recommend contacting the HFIM program office directly.",
          sources: [],
          linkedInProfiles: [],
          responseTime: Date.now() - startTime,
        });
      }

      return res.json({
        answer:
          "I couldn't find that information in my sources. Could you clarify or ask something else?",
        sources: [],
        responseTime: Date.now() - startTime,
      });
    }

    // 4) Call OpenAI with enhanced prompt
    const response = await openai.chat.completions.create({
      model: process.env.GEN_MODEL,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: message },
      ],
      temperature: isAggregation ? 0.3 : 0.7, // Lower temperature for factual lists
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
      responseTime: Date.now() - startTime,
    };

    // Always include LinkedIn profiles if we found any
    if (allLinkedInProfiles.length > 0) {
      responseData.linkedInProfiles = allLinkedInProfiles;
    }

    // Add debug info for aggregation queries
    if (DEBUG_RAG && isAggregation) {
      responseData.debug = {
        isAggregation: true,
        internshipsFound: internshipInfo.size,
        totalMatches: matches.length,
        linkedInProfilesFound: allLinkedInProfiles.length,
      };
    }

    console.log('Chat response sent:', {
      responseTime: responseData.responseTime,
      sourcesCount: responseData.sources.length,
      linkedInCount: allLinkedInProfiles.length,
      timestamp: new Date().toISOString(),
    });

    res.json(responseData);
  } catch (err) {
    console.error('ERROR /chat:', err);
    res.status(500).json({
      error: 'Chat request failed',
      message:
        NODE_ENV === 'development' ? err.message : 'Internal server error',
      responseTime: Date.now() - startTime,
    });
  }
});

// Optional: Add a dedicated endpoint to search for LinkedIn profiles
app.get('/linkedin-search', requireApiKey, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Name parameter required' });
    }

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
    res.status(500).json({
      error: 'LinkedIn search failed',
      message:
        NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});

// Catch-all route for SPA (serve index.html for all other routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 HFIM Chatbot server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Debug mode: ${DEBUG_RAG}`);
  if (NODE_ENV === 'development') {
    console.log(`Local URL: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
