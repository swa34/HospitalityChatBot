// src/rag/crawlBFS.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import slugify from 'slugify';

// --------- CONFIG (override via CLI args if you want) ---------
const START_URL =
  process.argv[2] || 'https://www.admissions.uga.edu/experience/';

const DOMAIN = process.argv[3] || 'www.caes.uga.edu'; // Only crawl this host
const PATH_PREFIX = process.argv[4] || '/students/'; // Only keep URLs starting with this path
const MAX_PAGES = parseInt(process.argv[5] || '30', 10); // safety limit
const MAX_DEPTH = parseInt(process.argv[6] || '3', 10); // max link depth from seed

// Output folder
const OUT_DIR = path.resolve('docs', 'web');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Turndown init
const turndown = new TurndownService();

// Simple delay to be polite to target server (ms)
const DELAY_MS = 300;

// --------------------------------------------------------------

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch, parse, extract main content + links
async function fetchAndParse(url) {
  const resp = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'HFIMBot/1.0 (+https://github.com/swa34)' },
  });

  const html = resp.data;
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Extract links
  const links = Array.from(doc.querySelectorAll('a[href]'))
    .map(a => a.getAttribute('href'))
    .filter(Boolean)
    .map(href => {
      try {
        return new URL(href, url).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Use Readability to get main content
  const reader = new Readability(doc);
  const article = reader.parse();

  const title = (article?.title || url).trim();
  const markdown = `# ${title}\n\nSource: ${url}\n\n${turndown.turndown(
    article?.content || html
  )}`;

  return { markdown, title, links };
}

function filterLinks(links) {
  return links.filter(href => {
    try {
      const u = new URL(href);
      return u.hostname === DOMAIN && u.pathname.startsWith(PATH_PREFIX);
    } catch {
      return false;
    }
  });
}

function saveMarkdown(title, url, markdown) {
  const fileName =
    slugify(title, { lower: true, strict: true }).substring(0, 80) ||
    slugify(url, { lower: true, strict: true }).substring(0, 80) ||
    'page';
  const filePath = path.join(OUT_DIR, `${fileName}.md`);
  fs.writeFileSync(filePath, markdown, 'utf-8');
  console.log(`Saved: ${filePath}`);
}

async function crawl() {
  const queue = [{ url: START_URL, depth: 0 }];
  const visited = new Set();
  let count = 0;

  while (queue.length && count < MAX_PAGES) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`Crawling (${depth}): ${url}`);
    try {
      const { markdown, title, links } = await fetchAndParse(url);
      saveMarkdown(title, url, markdown);
      count++;

      if (depth < MAX_DEPTH) {
        const filtered = filterLinks(links);
        for (const nextUrl of filtered) {
          if (!visited.has(nextUrl)) {
            queue.push({ url: nextUrl, depth: depth + 1 });
          }
        }
      }
    } catch (err) {
      console.error(`Failed: ${url} - ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`Crawl done. Scraped ${count} page(s). Files in docs/web.`);
  console.log('Now run: npm run ingest');
}

crawl();
