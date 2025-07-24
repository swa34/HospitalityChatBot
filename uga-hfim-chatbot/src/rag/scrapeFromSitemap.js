// src/rag/scrapeFromSitemap.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { gunzipSync } from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import slugify from 'slugify';

const SITEMAP_URL = process.argv[2] || 'https://www.caes.uga.edu/sitemap.xml';
const URL_FILTER = process.argv[3] || '/hfim'; // only include URLs that contain this text
const OUTPUT_DIR = path.resolve('docs', 'web');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const parser = new XMLParser();
const turndown = new TurndownService();

// Fetch and parse (possibly gzipped) sitemap XML
async function fetchSitemapXml(url) {
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (HFIMBot/1.0)' },
  });

  let buf = resp.data;
  const isGz =
    url.endsWith('.gz') || resp.headers['content-encoding'] === 'gzip';
  if (isGz) {
    buf = gunzipSync(buf);
  }
  const xmlStr = buf.toString('utf-8');
  return parser.parse(xmlStr);
}

// Recursively walk sitemap indexes
async function crawlSitemap(url, visited = new Set()) {
  if (visited.has(url)) return [];
  visited.add(url);

  let xml;
  try {
    xml = await fetchSitemapXml(url);
  } catch (err) {
    console.error(`Failed to fetch ${url}: ${err.message}`);
    return [];
  }

  const urls = [];

  // sitemapindex => nested sitemaps
  if (xml?.sitemapindex?.sitemap) {
    const list = Array.isArray(xml.sitemapindex.sitemap)
      ? xml.sitemapindex.sitemap
      : [xml.sitemapindex.sitemap];
    for (const sm of list) {
      const loc = sm.loc || sm['loc'];
      if (loc) {
        const nested = await crawlSitemap(loc.trim(), visited);
        urls.push(...nested);
      }
    }
  }

  // urlset => actual URLs
  if (xml?.urlset?.url) {
    const list = Array.isArray(xml.urlset.url)
      ? xml.urlset.url
      : [xml.urlset.url];
    for (const u of list) {
      const loc = u.loc || u['loc'];
      if (loc) urls.push(loc.trim());
    }
  }

  return urls;
}

async function fetchAndSave(url) {
  try {
    const resp = await axios.get(url, { timeout: 30000 });
    const html = resp.data;

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const title = (article?.title || url).trim();
    const markdown = `# ${title}\n\nSource: ${url}\n\n${turndown.turndown(
      article?.content || html
    )}`;

    const fileName =
      slugify(title, { lower: true, strict: true }).substring(0, 80) ||
      slugify(url);
    const finalPath = path.join(OUTPUT_DIR, `${fileName}.md`);
    fs.writeFileSync(finalPath, markdown, 'utf-8');
    console.log(`Saved: ${finalPath}`);
  } catch (err) {
    console.error(`Failed to fetch ${url}: ${err.message}`);
  }
}

(async function main() {
  console.log(`Reading sitemap: ${SITEMAP_URL}`);
  const allUrls = await crawlSitemap(SITEMAP_URL);
  console.log(`Found ${allUrls.length} total URLs`);

  const filtered = URL_FILTER
    ? allUrls.filter(u => u.includes(URL_FILTER))
    : allUrls;
  console.log(`Keeping ${filtered.length} URLs matching "${URL_FILTER}"`);

  for (const u of filtered) {
    await fetchAndSave(u);
  }

  console.log('Done scraping. Now run: npm run ingest');
})();
