import { writeFileSync } from "fs";
import axios from "axios";
import robotsParser from "robots-parser";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

export default async function collectUrlsAsync({
  keywords,
}: ICollectUrlsAsync) {
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const urls: string[] = [];

  // Function to check robots.txt
  const isAllowedToScrape = async (siteUrl: string) => {
    try {
      const robotsUrl = new URL("/robots.txt", siteUrl).href;
      const response = await axios.get(robotsUrl, { timeout: 5000 });
      const robotsTxt = response.data;
      const robots = robotsParser(robotsUrl, robotsTxt);

      return robots.isAllowed(siteUrl, "MyScraperBot");
    } catch (_) {
      console.log(
        `${siteUrl}: No robots.txt or failed to fetch robots.txt, assuming allowed.`
      );
      return true; // If no robots.txt, assume allowed
    }
  };

  for (const keyword of keywords) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
      keyword
    )}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    const pageUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .map((a) => a.href)
        .filter((href) => href.startsWith("http"));
    });

    // Filter URLs by robots.txt rules
    for (const url of pageUrls) {
      const siteUrl = new URL(url).origin;
      if (await isAllowedToScrape(siteUrl)) {
        urls.push(url);
      } else {
        console.log(`Skipping ${url} due to robots.txt restrictions.`);
      }
    }
  }
  writeFileSync(`urls.txt_${+new Date()}`, urls.join("\n"));

  await browser.close();
  console.log(`Collected ${urls.length} allowed URLs!`);

  return urls;
}

interface ICollectUrlsAsync {
  readonly keywords: string[];
}
