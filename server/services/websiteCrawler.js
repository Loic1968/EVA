/**
 * Website Crawler for EVA Memory Vault.
 * Uses Selenium (primary) for JS-rendered pages, fetch+cheerio (fallback) for static HTML.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const isPrivateIp = (ip) => {
  const ipType = net.isIP(ip);
  if (ipType === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.some(n => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (ipType === 6) {
    const n = ip.toLowerCase();
    if (n === '::1') return true;
    if (n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80')) return true;
    return false;
  }
  return true;
};

async function validateUrl(url) {
  const { URL } = require('url');
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Host not allowed');
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('IP not allowed');
  }
  try {
    const resolved = await dns.lookup(host, { all: true });
    const addrs = Array.isArray(resolved) ? resolved.map(r => r.address) : [resolved.address];
    if (addrs.some(addr => isPrivateIp(addr))) {
      throw new Error('Resolved to private IP');
    }
  } catch (e) {
    if (e.code === 'ENOTFOUND') throw new Error('Host not found');
    throw e;
  }
}

/** Extract text from HTML (strip scripts/styles, get body text) */
function extractTextFromHtml(html) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    $('script, style, nav, footer, noscript, iframe').remove();
    const text = $('body').text() || $('html').text() || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 500000);
  } catch {
    return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500000);
  }
}

/** Fallback: fetch via HTTP (no JS execution) */
async function crawlWithFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; EVA/1.0; +https://eva.halisoft.biz)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  clearTimeout(timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return extractTextFromHtml(html);
}

/** Primary: Selenium for JS-rendered pages */
async function crawlWithSelenium(url) {
  const { Builder, By, until } = require('selenium-webdriver');
  const chrome = require('selenium-webdriver/chrome');
  const options = new chrome.Options();
  options.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu');
  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
  try {
    await driver.get(url);
    await driver.wait(until.elementLocated(By.tagName('body')), 10000);
    const body = await driver.findElement(By.tagName('body'));
    let text = await body.getText();
    if (!text || text.length < 50) {
      const html = await driver.getPageSource();
      text = extractTextFromHtml(html);
    }
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, 500000);
  } finally {
    await driver.quit();
  }
}

/**
 * Crawl a URL and return extracted text.
 * Tries Selenium first (if Chrome available), falls back to fetch+cheerio.
 */
async function crawlWebsite(url) {
  let normalized = (url || '').trim();
  if (!normalized) throw new Error('URL is required');
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  await validateUrl(normalized);

  let text = null;
  try {
    text = await crawlWithSelenium(normalized);
    if (text && text.length > 100) return { text, method: 'selenium' };
  } catch (e) {
    console.warn('[WebsiteCrawler] Selenium failed, using fetch:', e.message);
  }
  text = await crawlWithFetch(normalized);
  return { text: text || '(no content extracted)', method: 'fetch' };
}

/**
 * Crawl URL, save to file, return document metadata for DB insert.
 */
async function crawlAndSave(url, uploadDir) {
  const { text, method } = await crawlWebsite(url);
  const { URL } = require('url');
  const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
  const safeHost = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filename = `crawled_${safeHost}_${Date.now()}.txt`;
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, text, 'utf-8');
  const fileSize = fs.statSync(filePath).size;
  return { filename, filePath, fileSize, fileType: 'txt', source: url, method };
}

module.exports = { crawlWebsite, crawlAndSave, validateUrl };
