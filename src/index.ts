import collectUrlsAsync from "./api/collectUrlsAsync";
import scrapeUrlAsync from "./api/scrapeUrlAsync";

(async () => {
  const keywords = [
    "best portfolio websites",
    "modern blog design",
    "minimalist web design",
  ];

  const urls = await collectUrlsAsync({ keywords });

  urls.forEach(async (url) => await scrapeUrlAsync(url));
})();
