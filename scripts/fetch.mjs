// scripts/fetch.mjs
// Pulls multiple RSS feeds, adds topic tagging, summarizes to ~2–3 lines,
// filters to true Market Research news, and writes /data/news.json

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- CONFIG ----------

// Feeds (can add/remove)
const FEEDS = [
  // Your focused MR publishers
  'https://www.research-live.com/rss',
  'https://www.quirks.com/rss',
  'https://www.mrweb.com/drno/rssdailynews.xml',

  // (Optional) Broader Google News scrape — filtered heavily below:
  'https://news.google.com/rss/search?q=%22market%20research%22%20OR%20%22consumer%20insights%22%20OR%20%22customer%20experience%22%20OR%20%22focus%20group%22%20OR%20%22survey%22&hl=en-IN&gl=IN&ceid=IN:en'
];

// ---------- MR FILTERS (NEW) ----------
// Keep real market-research stories (surveys, methods, qual/quant, CX, panels)
const POSITIVE_MR = [
  'market research','consumer insight','consumer insights','mrx',
  'survey','surveys','questionnaire','panel','panellist','sample',
  'focus group','fgd','qualitative','quantitative','ethnography','idi','in-depth interview',
  'discussion guide','concept test','copy test','ad test','ad testing','conjoint','segmentation',
  'maxdiff','van westendorp','gabor granger','cx','customer experience','nps','csat',
  'esomar','gritm','insight platform','fieldwork','cati','cawi','capi','online community',
  'diary study','usability test','card sort','tree test'
].map(s => s.toLowerCase());

// Block generic industry forecast/CAGR press-release noise
const NEGATIVE_GENERIC = [
  'forecast','forecasts','cagr','market size','usd','billion','million',
  '2024','2025','2026','2027','2028','2029','2030',
  'researchandmarkets','openpr','industrytoday','globenewswire','prnewswire',
  'financialcontent','yahoo finance','seeking alpha'
].map(s => s.toLowerCase());

// Trusted MR sources always allowed
const SOURCE_WHITELIST = [
  'research-live.com','www.research-live.com',
  'quirks.com','www.quirks.com',
  'mrweb.com','www.mrweb.com'
];

function hostname(u){
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

function isMRStory(item){
  const title = (item.title || '').toLowerCase();
  const sum = (item.raw || item.summary || '').toLowerCase();
  const text = `${title} ${sum}`;

  // hard block generic “industry forecast” noise
  if (NEGATIVE_GENERIC.some(neg => text.includes(neg))) return false;

  // Always accept trusted MR publishers
  const host = hostname(item.link);
  if (SOURCE_WHITELIST.includes(host)) return true;

  // Else require at least one MR-positive signal
  return POSITIVE_MR.some(pos => text.includes(pos));
}

// ---------- TOPICS ----------
const TOPICS = {
  'AI in MR': [
    'ai','artificial intelligence','genai','gpt','generative','llm','machine learning',
    'ml','nlp','langchain','vector db','rag','openai','anthropic','gemini'
  ],
  'CX': [
    'cx','customer experience','nps','csat','customer satisfaction','customer service',
    'contact center','call center','journey','touchpoint'
  ],
  'Ad testing': [
    'ad test','ad testing','copy test','creative test','ad effectiveness','brand lift',
    'pre-test','pretest','pre testing','ad recall'
  ],
  'B2B': [
    'b2b','enterprise','decision maker','procurement','it decision maker','idm'
  ],
  'Healthcare': [
    'healthcare','pharma','patient','hcp','clinical','medical device','medtech'
  ],
  'Innovation in MR': [
    'innovation','new methodology','new method','experimental','agile','mobile ethnography',
    'automation','synthetic data','digital behavior','behavioral'
  ],
  'Qualitative Research': [
    'qualitative','focus group','depth interview','idi','ethnography','co-creation',
    'discussion guide','transcript','thematic'
  ],
};

// Funding/M&A detector
function isFunding(title = '', summary = '') {
  const r = /(funding|raises|raised|seed|series\s+[a-e]\b|acquire|acquisition|merger|m&a|buyout|invests|investment|venture|vc)/i;
  return r.test(title) || r.test(summary);
}

// ---------- SUMMARIZATION ----------
const SUMMARY_MAX_CHARS = 240;

function summarizeFallback(text, max = SUMMARY_MAX_CHARS) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').replace(/<\/?[^>]+(>|$)/g, '').trim();
  const sentences = clean.split(/(?<=[.?!])\s+/).slice(0, 2).join(' ');
  const base = sentences || clean;
  return base.length > max ? base.slice(0, max - 1) + '…' : base;
}

async function summarizeAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return summarizeFallback(text);

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
  } catch
