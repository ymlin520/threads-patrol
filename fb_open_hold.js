// 開啟貼文、捲到留言、視窗留著不關（讓使用者自己手動刪重複留言）
// node fb_open_hold.js <postUrl> [holdSeconds]
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[hold]", ...a);
const url = process.argv[2];
const hold = Number(process.argv[3] || 240);
(async () => {
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({ storageState: FB_CONFIG.AUTH_FILE, viewport: { width: 1280, height: 950 }, locale: "zh-TW" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);
  // 捲到最底把最新的重複留言載出來
  for (let i = 0; i < 14; i++) {
    await page.evaluate(() => window.scrollBy(0, 1400)).catch(() => {});
    await page.waitForTimeout(1000);
  }
  log(`視窗已開啟並停在留言區，保留 ${hold} 秒供你手動刪除重複留言（在留言右上 ⋯ → 刪除）。`);
  await page.waitForTimeout(hold * 1000);
  await browser.close();
  process.exit(0);
})();
