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

// Configuration
const SITEMAP_URL =
  process.argv[2] || 'https://www.admissions.uga.edu/sitemap_index.xml';
const URL_FILTER = process.argv[3] || ''; // empty = scrape all URLs
const MAX_PAGES = parseInt(process.argv[4] || '100', 10); // safety limit
const OUTPUT_DIR = path.resolve('docs', 'web');
const DELAY_MS = 300; // delay between requests to be polite

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});
const turndown = new TurndownService();

// Track scraping progress
let scrapedCount = 0;
const scrapedUrls = new Set();

// Delay helper
async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch and parse (possibly gzipped) sitemap XML
async function fetchSitemapXml(url) {
  console.log(`  → Fetching sitemap: ${url}`);
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; UGABot/1.0)',
        Accept: 'application/xml, text/xml',
      },
    });

    let buf = resp.data;
    const isGz =
      url.endsWith('.gz') || resp.headers['content-encoding'] === 'gzip';
    if (isGz) {
      console.log('    (Decompressing gzipped content)');
      buf = gunzipSync(buf);
    }

    const xmlStr = buf.toString('utf-8');
    const parsed = parser.parse(xmlStr);

    // Log what type of sitemap we found
    if (parsed?.sitemapindex) {
      console.log(
        `    ✓ Found sitemap index with ${
          Array.isArray(parsed.sitemapindex.sitemap)
            ? parsed.sitemapindex.sitemap.length
            : 1
        } nested sitemaps`
      );
    } else if (parsed?.urlset) {
      const urlCount = Array.isArray(parsed.urlset.url)
        ? parsed.urlset.url.length
        : parsed.urlset.url
        ? 1
        : 0;
      console.log(`    ✓ Found URL set with ${urlCount} URLs`);
    }

    return parsed;
  } catch (err) {
    console.error(`    ✗ Failed to fetch ${url}: ${err.message}`);
    throw err;
  }
}

// Recursively walk sitemap indexes (handles Yoast SEO structure)
async function crawlSitemap(url, visited = new Set(), depth = 0) {
  if (visited.has(url)) return [];
  visited.add(url);

  if (depth > 3) {
    console.log(`  ⚠ Max depth reached, skipping: ${url}`);
    return [];
  }

  let xml;
  try {
    xml = await fetchSitemapXml(url);
  } catch (err) {
    return [];
  }

  const urls = [];

  // Handle sitemap index (like Yoast's sitemap_index.xml)
  if (xml?.sitemapindex?.sitemap) {
    console.log('\n📁 Processing sitemap index...');
    const sitemaps = Array.isArray(xml.sitemapindex.sitemap)
      ? xml.sitemapindex.sitemap
      : [xml.sitemapindex.sitemap];

    for (const sitemap of sitemaps) {
      const loc = sitemap.loc || sitemap['loc'];
      if (loc) {
        console.log(`\n🗂️  Found nested sitemap: ${loc}`);
        await sleep(DELAY_MS); // Be polite between sitemap fetches
        const nestedUrls = await crawlSitemap(loc.trim(), visited, depth + 1);
        urls.push(...nestedUrls);
      }
    }
  }

  // Handle URL set (actual content URLs)
  if (xml?.urlset?.url) {
    const urlList = Array.isArray(xml.urlset.url)
      ? xml.urlset.url
      : [xml.urlset.url];

    for (const urlObj of urlList) {
      const loc = urlObj.loc || urlObj['loc'];
      if (loc) {
        const cleanUrl = loc.trim();
        // Apply filter if specified
        if (!URL_FILTER || cleanUrl.includes(URL_FILTER)) {
          urls.push(cleanUrl);
        }
      }
    }
  }

  return urls;
}

// Fetch and save a single page
async function fetchAndSave(url) {
  if (scrapedUrls.has(url)) {
    console.log(`  ⏭️  Already scraped: ${url}`);
    return false;
  }

  if (scrapedCount >= MAX_PAGES) {
    console.log(`  ⚠️  Reached MAX_PAGES limit (${MAX_PAGES})`);
    return false;
  }

  try {
    console.log(`\n📄 Fetching page ${scrapedCount + 1}/${MAX_PAGES}: ${url}`);
    const resp = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; UGABot/1.0)',
      },
    });
    const html = resp.data;

    // Extract main content using Readability
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      console.log('  ⚠️  Could not extract article content');
      return false;
    }

    const title = (article.title || url).trim();
    const markdown = `# ${title}\n\nSource: ${url}\n\n${turndown.turndown(
      article.content
    )}`;

    // Generate filename
    const fileName =
      slugify(title, { lower: true, strict: true }).substring(0, 80) ||
      slugify(url.replace(/https?:\/\//, '').replace(/\//g, '-'), {
        lower: true,
        strict: true,
      }).substring(0, 80) ||
      `page-${scrapedCount}`;

    const finalPath = path.join(OUTPUT_DIR, `${fileName}.md`);

    // Handle duplicate filenames
    let finalFilePath = finalPath;
    let counter = 1;
    while (fs.existsSync(finalFilePath)) {
      finalFilePath = path.join(OUTPUT_DIR, `${fileName}-${counter}.md`);
      counter++;
    }

    fs.writeFileSync(finalFilePath, markdown, 'utf-8');
    console.log(`  ✅ Saved: ${path.basename(finalFilePath)}`);

    scrapedUrls.add(url);
    scrapedCount++;
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to fetch ${url}: ${err.message}`);
    return false;
  }
}

// Main function
(async function main() {
  console.log('🚀 Starting sitemap scraper...');
  console.log(`📍 Sitemap URL: ${SITEMAP_URL}`);
  console.log(`🔍 URL Filter: ${URL_FILTER || '(none - scraping all URLs)'}`);
  console.log(`📊 Max pages: ${MAX_PAGES}`);
  console.log(`📁 Output directory: ${OUTPUT_DIR}\n`);

  console.log('🕸️  Crawling sitemap structure...');
  const allUrls = await crawlSitemap(SITEMAP_URL);

  console.log(`\n✨ Found ${allUrls.length} total URLs`);

  if (URL_FILTER) {
    const filtered = allUrls.filter(u => u.includes(URL_FILTER));
    console.log(
      `🔍 After filtering: ${filtered.length} URLs matching "${URL_FILTER}"`
    );
  }

  // Remove duplicates
  const uniqueUrls = [...new Set(allUrls)];
  console.log(
    `🔗 Unique URLs to scrape: ${Math.min(uniqueUrls.length, MAX_PAGES)}`
  );

  // Scrape pages with delay
  console.log('\n📥 Starting page scraping...');
  for (const url of uniqueUrls) {
    if (scrapedCount >= MAX_PAGES) break;

    await fetchAndSave(url);

    // Be polite between requests
    if (scrapedCount < uniqueUrls.length && scrapedCount < MAX_PAGES) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n✅ Scraping complete!');
  console.log(`📊 Total pages scraped: ${scrapedCount}`);
  console.log(`📁 Files saved to: ${OUTPUT_DIR}`);
  console.log('\n💡 Next step: Run "npm run ingest" to process these files');
})();
