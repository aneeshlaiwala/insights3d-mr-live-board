# Market Research Live Board

A lightweight, auto-updating HTML page that shows:
- Top 6 (or more) market-research-related news (title, summary, link)
- Funding & M&A section
- Bottom ticker
- Clickable trending hashtags (X search links)

## How it works
- Static site (HTML + Tailwind) served via GitHub Pages.
- An hourly GitHub Action runs `scripts/fetch.mjs` (Node) that pulls RSS feeds, builds `data/news.json`, and commits it back.
- The page fetches `data/news.json` and renders it client-side.

## Deploy (GitHub Pages)
1. Create a new repo and push these files.
2. In **Settings → Pages**, choose the `main` branch (root) for Pages.
3. In **Actions**, enable workflows if asked. The "Fetch News (hourly)" job will run at the top of each hour.
4. Edit `scripts/fetch.mjs` and add/curate your favorite MR feeds.

> No server needed. No paid APIs required. Replace the Google News RSS with your preferred sources for best results.
