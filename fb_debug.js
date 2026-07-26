// 除錯：看 FB 搜尋頁到底載入了什麼、有沒有被擋、DOM 有無貼文、有哪些 graphql 回應
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = FB_CONFIG.BASE_URL;
const log = (...a) => console.log("[dbg]", ...a);

(async () => {
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: FB_CONFIG.AUTH_FILE,
    viewport: { width: 1280, height: 900 }, locale: "zh-TW",
  });
  const page = await context.newPage();

  const respUrls = [];
  page.on("response", (resp) => {
    const u = resp.url();
    if (/graphql|\/api\//i.test(u)) respUrls.push(u.slice(0, 120));
  });

  const kw = "生日蛋糕推薦";
  log("先到首頁確認登入…");
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);
  const loginState = await page.evaluate(() => ({
    title: document.title,
    hasComposer: !!document.querySelector('[aria-label*="貼文"],[aria-label*="在想些什麼"],[role="navigation"]'),
    bodyStart: document.body?.innerText?.slice(0, 200) || "",
  }));
  log("首頁：", JSON.stringify(loginState));

  log(`前往搜尋「${kw}」…`);
  await page.goto(`${BASE}/search/posts?q=${encodeURIComponent(kw)}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollBy(0, 2000)).catch(() => {});
  await page.waitForTimeout(4000);

  const dom = await page.evaluate(() => {
    const arts = document.querySelectorAll('div[role="article"]');
    const samples = [];
    arts.forEach((a, i) => {
      if (i < 5) samples.push((a.innerText || "").replace(/\s+/g, " ").slice(0, 120));
    });
    // 抓所有像貼文永久連結的 href
    const links = new Set();
    document.querySelectorAll('a[href*="/posts/"],a[href*="/permalink/"],a[href*="story_fbid"],a[href*="/groups/"]').forEach((a) => {
      if (links.size < 10) links.add(a.getAttribute("href").slice(0, 100));
    });
    return {
      url: location.href,
      title: document.title,
      articleCount: arts.length,
      articleSamples: samples,
      sampleLinks: [...links],
      bodyStart: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 300),
    };
  });

  fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "output", "fb_debug.json"),
    JSON.stringify({ dom, graphqlResponseCount: respUrls.length, respUrlsSample: respUrls.slice(0, 15) }, null, 2), "utf8");

  log("最終網址：", dom.url);
  log("頁面標題：", dom.title);
  log("DOM article 數量：", dom.articleCount);
  log("graphql/api 回應數：", respUrls.length);
  log("article 範例：", JSON.stringify(dom.articleSamples, null, 2));
  log("永久連結範例：", JSON.stringify(dom.sampleLinks, null, 2));
  log("body 開頭：", dom.bodyStart);

  await page.waitForTimeout(1500);
  await browser.close();
  process.exit(0);
})();
