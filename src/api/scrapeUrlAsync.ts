import { writeFileSync } from "fs";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

export default async function scrapeUrlAsync(url: string) {
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  function extractData(document: Document) {
    const html = document.documentElement.outerHTML;
    const css = Array.from(document.querySelectorAll("*")).map((el) => ({
      tag: el.tagName,
      classList: Array.from(el.classList),
      id: el.id,
      styles: getComputedStyle(el),
    }));

    return { html, css };
  }
  function saveData(data: { html: string; css: any[] }) {
    try {
      writeFileSync("page.html", data.html);
      console.log("✔ saved: html");
    } catch (error) {
      console.warn("Couldn't save html", error);
    }

    try {
      writeFileSync("styles.json", JSON.stringify(data.css, null, 2));
      console.log("✔ saved: css");
    } catch (error) {
      console.warn("Couldn't save css", error);
    }
  }

  await page.goto(url, { waitUntil: "networkidle2" });
  const data = await page.evaluate(() => extractData(document));

  await Promise.all([
    async () =>
      await page.screenshot({ path: "screenshot.png", fullPage: true }),
    () => saveData(data),
  ])
    .then(([screenshot, data]) => {
      console.log("✔ saved: html, css, screenshot");
    })
    .catch((error) => {
      console.error("Couldn't save data", error);
    })
    .finally(browser.close);
}
