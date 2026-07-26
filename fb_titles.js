// 讀出每篇 FB 貼文的 page title（含原po原文），幫忙挑「在求蛋糕推薦」的
// node fb_titles.js
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[titles]", ...a);

const all = JSON.parse(fs.readFileSync(path.join(__dirname, "output", "fb_cake_all.json"), "utf8"));
// 排除明顯非「找蛋糕」的社團（烘焙教學/實習/海外/飯糰等）
const SKIP = /cake\.internship|chiffoncakes|discoverspain|studentenverein|okifreeto|1588488514910221/;
const urls = [...new Set(all.map(p => p.url))].filter(u => u && !SKIP.test(u));

(async () => {
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({ storageState: FB_CONFIG.AUTH_FILE, viewport: { width: 1200, height: 850 }, locale: "zh-TW" });
  const page = await context.newPage();
  const rows = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    await page.goto(u, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);
    let title = await page.title().catch(() => "");
    // 標題格式常是「社團名 | 原po內文 | Facebook」，取中間段
    const parts = title.split("|").map(s => s.trim());
    const orig = parts.length >= 3 ? parts.slice(1, -1).join(" | ") : title;
    rows.push({ url: u, group: parts[0] || "", orig });
    log(`[${i + 1}/${urls.length}] ${(parts[0] || "").slice(0, 14)} :: ${orig.slice(0, 60)}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, "output", "fb_titles.json"), JSON.stringify(rows, null, 2), "utf8");
  log("輸出：output/fb_titles.json");
  process.exit(0);
})();
