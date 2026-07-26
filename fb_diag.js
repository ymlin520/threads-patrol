import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[diag]", ...a);
const url = process.argv[2];
(async () => {
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({ storageState: FB_CONFIG.AUTH_FILE, viewport: { width: 1280, height: 950 }, locale: "zh-TW" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const buttons = [...document.querySelectorAll('[role="button"],a')].map(b => (b.innerText || "").trim()).filter(Boolean);
    const has = (s) => buttons.some(b => b.includes(s)) || txt.includes(s);
    const boxes = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"]')];
    const boxInfo = boxes.slice(0, 6).map(b => ({
      aria: b.getAttribute("aria-label") || b.getAttribute("aria-placeholder") || "",
      placeholder: b.getAttribute("data-placeholder") || "",
    }));
    return {
      title: document.title,
      isMember: has("你是社團成員") || has("以社團成員") || (!has("加入社團") && !has("Join group") && !has("加入群組")),
      joinBtn: has("加入社團") || has("加入群組") || has("Join group"),
      writeCommentHint: has("寫下你的留言") || has("寫留言") || has("留言…") || has("Write a comment"),
      needApproval: has("留言需要審核") || has("待審") || has("pending"),
      commentBoxes: boxInfo,
    };
  }).catch((e) => ({ error: String(e) }));
  log(JSON.stringify(info, null, 2));
  await page.waitForTimeout(1500);
  await browser.close();
  process.exit(0);
})();
