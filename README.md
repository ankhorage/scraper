# Scraper

Url collector & scraper based on `puppeteer` headless browser.

- It uses the StealthPlugin from `puppeteer-extra`
- It respects `robots.txt`

## Quickstart

```bash
# Build
pnpm run build

# Run (search url's & save html, css & screenshot of every one found)
node dist/index.js
```

## API

### collectUrlsAsync({ keywords: string[] })

Collects urls from google search

### scrapeUrlAsync(url: string)

Scrapes `url` and will save: html & css plus a screenshot
