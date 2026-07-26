// ── FB 版：找「在徵蛋糕推薦」的 Facebook 貼文（DOM 版）──────────────
// 用法：node fb_find_cake_seekers.js   （需先 npm run fb-auth）
// FB 攔 GraphQL 不穩，改成直接讀搜尋結果頁的 DOM：
//   逐一讀 div[role="article"] 的文字 + 抓貼文永久連結，再挑出「在求蛋糕推薦」的。

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = FB_CONFIG.BASE_URL;
const log = (...a) => console.log("[fb-cake]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

const KEYWORDS = [
  "生日蛋糕推薦", "蛋糕推薦", "求推薦蛋糕", "找蛋糕", "客製蛋糕推薦",
  "彌月蛋糕推薦", "巴斯克推薦", "生日蛋糕",
];
const ASK_CUES = ["推薦", "有沒有", "求", "找", "請問", "哪裡", "哪家", "哪間", "想找", "想要", "?", "？"];
const CAKE_CUES = ["蛋糕", "巴斯克", "戚風", "千層", "生乳酪", "生乳捲", "布丁"];
const TARGET = 50;
const SCROLLS_PER_KEYWORD = 14;

const posts = new Map(); // url -> {author, content, url, matched_keyword}

// 在頁面內把每則 article 的文字＋永久連結抽出來
async function scrapeArticles(page, kw) {
  const items = await page.evaluate(() => {
    const out = [];
    const arts = document.querySelectorAll('div[role="article"]');
    arts.forEach((a) => {
      const text = (a.innerText || "").replace(/\r/g, "").trim();
      if (!text) return;
      // 找貼文永久連結（優先社團/個人貼文，排除 user 個人檔案連結）
      let url = "";
      const links = a.querySelectorAll(
        'a[href*="/posts/"],a[href*="/permalink/"],a[href*="story_fbid"],a[href*="/photos/"]'
      );
      for (const l of links) {
        const href = l.getAttribute("href") || "";
        if (/\/user\//.test(href)) continue;
        if (/\/(posts|permalink|photos)\/|story_fbid/.test(href)) {
          url = href.split("?")[0];
          if (!url.startsWith("http")) url = "https://www.facebook.com" + url;
          break;
        }
      }
      out.push({ text, url });
    });
    return out;
  }).catch(() => []);

  for (const it of items) {
    if (!it.url) continue;
    if (posts.has(it.url)) continue;
    // 第一行通常是作者名
    const firstLine = it.text.split("\n")[0].split("·")[0].trim();
    posts.set(it.url, {
      matched_keyword: kw,
      author: firstLine.slice(0, 40),
      content: it.text.replace(/\s+/g, " ").trim(),
      url: it.url,
    });
  }
}

(async () => {
  if (!fs.existsSync(path.join(__dirname, FB_CONFIG.AUTH_FILE))) {
    log("找不到 fb_auth_state.json，請先執行：npm run fb-auth"); process.exit(1);
  }
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: FB_CONFIG.AUTH_FILE,
    viewport: { width: 1280, height: 900 }, locale: "zh-TW",
  });
  const page = await context.newPage();

  for (let i = 0; i < KEYWORDS.length; i++) {
    if (posts.size >= TARGET) break;
    const kw = KEYWORDS[i];
    log(`[${i + 1}/${KEYWORDS.length}] 搜尋「${kw}」 (已 ${posts.size} 篇)`);
    await page.goto(`${BASE}/search/posts?q=${encodeURIComponent(kw)}`,
      { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(4000);
    for (let s = 0; s < SCROLLS_PER_KEYWORD; s++) {
      if (posts.size >= TARGET) break;
      await scrapeArticles(page, kw);
      await page.evaluate(() => window.scrollBy(0, 1600)).catch(() => {});
      await page.waitForTimeout(rnd(1800, 3200));
    }
    await scrapeArticles(page, kw);
  }
  await browser.close();

  // 判定「在徵蛋糕」：有問句線索 + 蛋糕字，且排除明顯店家自推
  const all = [...posts.values()].map((p) => {
    const askish = ASK_CUES.some((c) => p.content.includes(c));
    const cakeish = CAKE_CUES.some((c) => p.content.includes(c));
    const selfPromo = /(自推|自薦|我們是|歡迎來|line id|訂購請|預購|開賣|下單|接單|私訊小盒|加賴|門市|營業時間)/i.test(p.content);
    return { ...p, is_seeker: askish && cakeish && !selfPromo };
  });
  const seekers = all.filter((p) => p.is_seeker);

  fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "output", "fb_cake_seekers.json"), JSON.stringify(seekers, null, 2), "utf8");
  fs.writeFileSync(path.join(__dirname, "output", "fb_cake_all.json"), JSON.stringify(all, null, 2), "utf8");

  log(`──────── 完成：共抓 ${all.length} 篇，判定為「在徵蛋糕」的有 ${seekers.length} 篇 ────────`);
  seekers.slice(0, 20).forEach((p, i) =>
    log(`#${i + 1} ${p.author}  ${p.content.slice(0, 45)}…\n     ${p.url}`));
  log("輸出：output/fb_cake_seekers.json");
  process.exit(0);
})();
