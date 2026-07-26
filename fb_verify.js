// 驗證某貼文裡是否已有含 needle 的留言
// node fb_verify.js <postUrl> <needle>
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[verify]", ...a);
const url = process.argv[2];
const needle = process.argv[3] || "瑞莎塔";
(async () => {
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({ storageState: FB_CONFIG.AUTH_FILE, viewport: { width: 1280, height: 950 }, locale: "zh-TW" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);
  // 嘗試把留言切成「最新」以便看到自己剛留的
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollBy(0, 1400)).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const found = await page.evaluate((needle) => {
    const arts = [...document.querySelectorAll('div[role="article"]')];
    const hits = [];
    arts.forEach((a) => {
      const t = (a.innerText || "").replace(/\s+/g, " ").trim();
      if (t.includes(needle)) hits.push(t.slice(0, 200));
    });
    return { total: arts.length, hits };
  }, needle).catch(() => ({ total: 0, hits: [] }));
  log("掃描 article 數：", found.total);
  log(`含「${needle}」的留言數：`, found.hits.length);
  found.hits.forEach((h, i) => log(`  ✔ [${i}] ${h}`));
  if (!found.hits.length) log("❌ 沒找到，可能未送出成功、或需登入該社團/留言尚未載入");
  await page.waitForTimeout(1500);
  await browser.close();
  process.exit(0);
})();
