/**
 * web.search — Multi-provider web search.
 * Priority: Tavily (if TAVILY_API_KEY set) > DuckDuckGo (free, no key).
 * DuckDuckGo uses the HTML lite endpoint — zero cost, zero config.
 */
const TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS) || 10000;
// ── DuckDuckGo (free, no API key) ──
// Uses the HTML lite version, parses result links + snippets.
async function searchDuckDuckGo(q, maxResults) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EVA-MCP/1.0)',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
            },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
            throw new Error(`DuckDuckGo HTTP ${res.status}`);
        }
        const html = await res.text();
        return parseDuckDuckGoHTML(html, maxResults);
    }
    catch (e) {
        clearTimeout(timeout);
        throw e;
    }
}
function parseDuckDuckGoHTML(html, maxResults) {
    const results = [];
    // DDG lite HTML structure: each result is in a <div class="result__body">
    // with <a class="result__a" href="...">title</a> and <a class="result__snippet">text</a>
    // We also handle the regular html.duckduckgo.com format
    // Strategy: find all result blocks with links and snippets
    // Pattern 1: result__a links (DDG lite format)
    const resultBlocks = html.split(/class="result(?:__body|s_links_deep)"/i);
    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
        const block = resultBlocks[i];
        // Extract URL — look for result__a or first meaningful href
        const urlMatch = block.match(/href="([^"]+)"[^>]*class="result__a"/i)
            || block.match(/class="result__a"[^>]*href="([^"]+)"/i)
            || block.match(/href="(https?:\/\/[^"]+)"/i);
        if (!urlMatch)
            continue;
        let href = urlMatch[1];
        // DDG wraps URLs in redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
        if (href.includes('uddg=')) {
            const uddg = href.match(/uddg=([^&]+)/);
            if (uddg)
                href = decodeURIComponent(uddg[1]);
        }
        // Skip DDG internal links
        if (href.includes('duckduckgo.com') && !href.includes('uddg='))
            continue;
        // Extract title
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</i)
            || block.match(/>([^<]{5,80})<\/a>/i);
        const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : href;
        // Extract snippet
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span|div)/i)
            || block.match(/class="result__snippet"[^>]*>([\s\S]*?)$/i);
        let content = '';
        if (snippetMatch) {
            content = decodeHTMLEntities(snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        }
        if (href && title) {
            results.push({ title, url: href, content: content.slice(0, 500), source: 'duckduckgo' });
        }
    }
    // Fallback: simpler regex if structured parsing found nothing
    if (results.length === 0) {
        const linkPattern = /href="(https?:\/\/(?!duckduckgo\.com)[^"]+)"[^>]*>([^<]+)<\/a>/gi;
        let match;
        const seen = new Set();
        while ((match = linkPattern.exec(html)) !== null && results.length < maxResults) {
            let href = match[1];
            if (href.includes('uddg=')) {
                const uddg = href.match(/uddg=([^&]+)/);
                if (uddg)
                    href = decodeURIComponent(uddg[1]);
            }
            if (seen.has(href) || href.includes('duckduckgo.com'))
                continue;
            seen.add(href);
            const title = decodeHTMLEntities(match[2].trim());
            if (title.length > 3) {
                results.push({ title, url: href, content: '', source: 'duckduckgo' });
            }
        }
    }
    return results;
}
function decodeHTMLEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
// ── Tavily (premium, optional) ──
async function searchTavily(q, maxResults, opts) {
    const apiKey = (process.env.TAVILY_API_KEY || '').trim();
    if (!apiKey)
        throw new Error('No TAVILY_API_KEY');
    const body = {
        query: q.slice(0, 500),
        max_results: maxResults,
        search_depth: opts.searchDepth === 'advanced' ? 'advanced' : 'basic',
        topic: ['general', 'news', 'finance'].includes(opts.topic) ? opts.topic : 'general',
    };
    if (opts.timeRange && ['day', 'week', 'month', 'year'].includes(opts.timeRange)) {
        body.time_range = opts.timeRange;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Tavily ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return (data?.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        content: (r.content || '').slice(0, 2000),
        source: 'tavily',
    }));
}
// ── Main handler ──
export async function webSearch(args, _ctx) {
    const { query, topic, max_results, search_depth, time_range } = args;
    const q = (typeof query === 'string' ? query : '').trim();
    if (!q) {
        return { ok: false, error: 'query is required (string, max 500 chars)' };
    }
    const maxResults = Math.max(1, Math.min(20, Number(max_results) || 5));
    const hasTavily = !!(process.env.TAVILY_API_KEY || '').trim();
    let results = [];
    let provider = 'duckduckgo';
    // Try Tavily first if available (better snippets, topic filtering)
    if (hasTavily) {
        try {
            results = await searchTavily(q, maxResults, {
                topic: topic,
                searchDepth: search_depth,
                timeRange: time_range,
            });
            provider = 'tavily';
        }
        catch (e) {
            console.error('[MCP web.search] Tavily failed, falling back to DuckDuckGo:', e.message);
        }
    }
    // DuckDuckGo fallback (or primary if no Tavily)
    if (results.length === 0) {
        try {
            // For news queries, append "news" to the DuckDuckGo query for better results
            const ddgQuery = topic === 'news' ? `${q} news` : q;
            results = await searchDuckDuckGo(ddgQuery, maxResults);
            provider = 'duckduckgo';
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `Web search failed: ${msg}` };
        }
    }
    return {
        ok: true,
        data: {
            query: q,
            provider,
            results_count: results.length,
            results,
        },
    };
}
export async function webSearchNews(args, ctx) {
    return webSearch({ ...args, topic: 'news', time_range: args.time_range || 'day' }, ctx);
}
