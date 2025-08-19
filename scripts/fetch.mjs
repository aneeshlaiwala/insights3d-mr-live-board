// scripts/fetch.mjs
// Pulls multiple RSS feeds, adds topic tagging, summarizes to ~2–3 lines,
// and writes /data/news.json

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- CONFIG ----------

// Feeds (can add/remove)
const FEEDS = [
  // Broad search
  'https://news.google.com/rss/search?q=%22market%20research%22%20OR%20%22consumer%20insights%22&hl=en-IN&gl=IN&ceid=IN:en',

  // Specific industry sources
  'https://www.research-live.com/rss',
  'https://www.quirks.com/rss',
  'https://www.mrweb.com/drno/rssdailynews.xml'
];

// Topic definitions (simple keyword maps)
const TOPICS = {
  'AI in MR': [
    'ai', 'artificial intelligence', 'genai', 'gpt', 'generative', 'llm', 'machine learning',
    'ml', 'nlp', 'langchain', 'vector db', 'rag', 'openai', 'anthropic', 'gemini'
  ],
  'CX': [
    'cx', 'customer experience', 'nps', 'csat', 'customer satisfaction', 'customer service',
    'contact center', 'call center', 'journey', 'touchpoint'
  ],
  'Ad testing': [
    'ad test', 'ad testing', 'copy test', 'creative test', 'ad effectiveness', 'brand lift',
    'pre-test', 'pretest', 'pre testing', 'ad recall'
  ],
  'B2B': [
    'b2b', 'enterprise', 'decision maker', 'procurement', 'it decision maker', 'idm'
  ],
  'Healthcare': [
    'healthcare', 'pharma', 'patient', 'hcp', 'clinical', 'medical device', 'medtech'
  ],
  'Innovation in MR': [
    'innovation', 'new methodology', 'new method', 'experimental', 'agile', 'mobile ethnography',
    'automation', 'synthetic data', 'digital behavior', 'behavioral'
  ],
  'Qualitative Research': [
    'qualitative', 'focus group', 'depth interview', 'idi', 'ethnography', 'co-creation',
    'discussion guide', 'transcript', 'thematic'
  ],
};

// Funding/M&A detector
function isFunding(title = '', summary = '') {
  const r = /(funding|raises|raised|seed|series\s+[a-e]\b|acquire|acquisition|merger|m&a|buyout|invests|investment|venture|vc)/i;
  return r.test(title) || r.test(summary);
}

// ---------- SUMMARIZATION ----------

// Hard cap for ~2–3 lines. UI clamps visually; we still keep text tidy.
const SUMMARY_MAX_CHARS = 240;

// Lightweight fallback summarizer (no API key required)
function summarizeFallback(text, max = SUMMARY_MAX_CHARS) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').replace(/<\/?[^>]+(>|$)/g, '').trim();

  // Grab first sentence or two
  const sentences = clean.split(/(?<=[.?!])\s+/).slice(0, 2).join(' ');
  const base = sentences || clean;
  return base.length > max ? base.slice(0, max - 1) + '…' : base;
}

// Optional: OpenAI summarizer (if OPENAI_API_KEY is set in env)
async function summarizeAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return summarizeFallback(text);

  // Node 18+ has global fetch
  const prompt = `Summarize this news blurb for a market research dashboard in 2 crisp lines (max ~240 characters total). No fluff, just the key point:\n\n"""${text}"""`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 120
      })
    });

    if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}`);
    const data = await resp.json();
    const out = data?.choices?.[0]?.message?.content?.trim() || '';
    return out ? summarizeFallback(out) : summarizeFallback(text);
  } catch (e) {
    console.error('OpenAI summarize failed:', e.message);
    return summarizeFallback(text);
  }
}

// ---------- TOPIC TAGGING ----------
function tagTopics(str) {
  const s = (str || '').toLowerCase();
  const hit = [];
  for (const [topic, kws] of Object.entries(TOPICS)) {
    for (const kw of kws) {
      if (s.includes(kw)) { hit.push(topic); break; }
    }
  }
  return hit.length ? hit : ['(Other)'];
}

// ---------- PIPELINE ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parser = new Parser();

function toItem(entry) {
  const title = entry.title || 'Untitled';
  const link = entry.link;
  const isoDate = entry.isoDate || entry.pubDate || new Date().toISOString();
  const source = (() => {
    try { return (entry.link ? new URL(entry.link).hostname.replace(/^www\./,'') : '') || (entry.creator || entry.author) || ''; }
    catch { return entry.creator || entry.author || ''; }
  })();
  const raw = entry.contentSnippet || entry.summary || entry.content || '';
  return { title, link, isoDate, source, raw };
}

function dedupeSort(all) {
  const seen = new Set();
  const dedup = [];
  for (const it of all) {
    if (!it.link || seen.has(it.link)) continue;
    seen.add(it.link);
    dedup.push(it);
  }
  dedup.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
  return dedup;
}

function makeHashtags(items) {
  const stop = new Set('the a an and or to for of in on with & from by as into over under about at is are was were be being been this that those these it its their our your his her them you we they research market consumer insight ai data survey brand study report'.split(' '));
  const freq = {};
  for (const it of items) {
    const words = (it.title || '').toLowerCase().replace(/[^a-z0-9\s#]/g, '').split(/\s+/);
    for (const w of words) {
      if (!w || stop.has(w) || w.length < 3) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => ({ label: `#${w}`, url: `https://x.com/search?q=%23${encodeURIComponent(w)}` }));
}

async function run() {
  const collected = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) collected.push(toItem(item));
    } catch (e) {
      console.error('Feed error', url, e.message);
    }
  }

  const items = dedupeSort(collected);

  // Summarize + topic-tag in parallel
  const enriched = await Promise.all(items.map(async (it) => {
    const topics = tagTopics(`${it.title} ${it.raw}`);
    const summary = await summarizeAI(it.raw || it.title);
    return { ...it, summary, topics };
  }));

  const top_news = enriched.slice(0, 50); // keep a buffer; UI shows 6
  const funding_ma = enriched.filter(it => isFunding(it.title, it.summary)).slice(0, 50);
  const ticker = enriched.slice(0, 30).map(it => ({ text: it.title, link: it.link }));
  const hashtags = makeHashtags(top_news);

  const out = {
    generated_at: new Date().toISOString(),
    topics_available: Object.keys(TOPICS),
    top_news,
    funding_ma,
    hashtags,
    ticker
  };

  const outPath = path.join(__dirname, '..', 'data', 'news.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log('Wrote', outPath, 'items:', {
    top_news: out.top_news.length,
    funding_ma: out.funding_ma.length
  });
}

run();
