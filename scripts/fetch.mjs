// scripts/fetch.mjs
// Node script that pulls multiple RSS feeds, extracts top news, funding/M&A,
// builds hashtags, and writes /data/news.json
import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEEDS = [
  // 👉 Replace/extend with trusted Market Research sources you follow
  'https://news.google.com/rss/search?q=%22market%20research%22%20OR%20%22consumer%20insights%22&hl=en-IN&gl=IN&ceid=IN:en',
  // Add more: company blogs, industry publications, etc.
  // Research Live
  'https://www.research-live.com/rss',

  // Quirk’s
  'https://www.quirks.com/rss',

  // MRWeb (daily newswire)
  'https://www.mrweb.com/drno/rssdailynews.xml'
];

const parser = new Parser();

function summarize(text, max=220){
  if(!text) return '';
  // naive summary: strip newlines & trim
  const s = text.replace(/\s+/g,' ').trim();
  return s.length > max ? s.slice(0, max-1) + '…' : s;
}

function isFunding(title=''){
  const r = /(funding|raises|raised|seed|series\s+[A-E]|acquire|acquisition|merger|M&A|buyout|invests|investment)/i;
  return r.test(title);
}

function makeHashtagCandidates(items){
  const stop = new Set('the a an and or to for of in on with & from by as into over under about at is are was were be being been this that those these it its their our your his her them you we they research market consumer insight ai data survey brand'.split(' '));
  const freq = {};
  for(const it of items){
    const words = (it.title || '').toLowerCase().replace(/[^a-z0-9\s#]/g,'').split(/\s+/);
    for(const w of words){
      if(!w || stop.has(w) || w.length < 3) continue;
      freq[w] = (freq[w]||0)+1;
    }
  }
  const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([w])=>w);
  // Turn into clickable Twitter/X search links (no API needed)
  return top.map(w => ({ label: `#${w}`, url: `https://x.com/search?q=%23${encodeURIComponent(w)}` }));
}

function toItem(entry){
  return {
    title: entry.title || 'Untitled',
    link: entry.link,
    isoDate: entry.isoDate || entry.pubDate || new Date().toISOString(),
    source: (entry.creator || entry.author || (entry.link ? new URL(entry.link).hostname.replace('www.','') : '')),
    summary: summarize(entry.contentSnippet || entry.content || entry.summary)
  };
}

async function run(){
  const all = [];
  for(const url of FEEDS){
    try{
      const feed = await parser.parseURL(url);
      for(const item of feed.items || []){
        all.push(toItem(item));
      }
    }catch(e){
      console.error('Feed error', url, e.message);
    }
  }
  // dedupe by link
  const seen = new Set();
  const dedup = [];
  for(const it of all){
    if(!it.link || seen.has(it.link)) continue;
    seen.add(it.link);
    dedup.push(it);
  }
  // sort by date desc
  dedup.sort((a,b)=> new Date(b.isoDate) - new Date(a.isoDate));

  const top_news = dedup.slice(0, 24);
  const funding_ma = dedup.filter(it => isFunding(it.title) || isFunding(it.summary)).slice(0, 24);
  const hashtags = makeHashtagCandidates(top_news);
  const ticker = dedup.slice(0, 20).map(it => ({ text: it.title, link: it.link }));

  const out = {
    generated_at: new Date().toISOString(),
    top_news, funding_ma, hashtags, ticker
  };

  const outPath = path.join(__dirname, '..', 'data', 'news.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log('Wrote', outPath);
}

run();
