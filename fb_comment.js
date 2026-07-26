// ── 讀取 / (受控)留言 單一 FB 貼文 ─────────────────────────────
// 讀取：  node fb_comment.js read  <postUrl>
// 送出：  node fb_comment.js post  <postUrl>  "<留言內容>"
// 送出模式會實際張貼留言（不可收回），務必先 read 確認內容再用。

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG } from "./fb_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[fb-cmt]", ...a);

const mode = process.argv[2] || "read";
const url = process.argv[3];
const commentText = process.argv[4] || "";

if (!url) { log("缺少貼文網址"); process.exit(1); }

(async () => {
  if (!fs.existsSync(path.join(__dirname, FB_CONFIG.AUTH_FILE))) {
    log("找不到 fb_auth_state.json，請先執行：npm run fb-auth"); process.exit(1);
  }
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: FB_CONFIG.AUTH_FILE,
    viewport: { width: 1280, height: 950 }, locale: "zh-TW",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(5000);

  // 嘗試把留言排序切到「最相關/全部留言」並展開
  await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
  await page.waitForTimeout(2500);

  // 讀原po文字（通常是第一個 role=article）＋前幾則留言
  const data = await page.evaluate(() => {
    const arts = [...document.querySelectorAll('div[role="article"]')];
    const texts = arts.slice(0, 12).map((a) => (a.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return { title: document.title, count: arts.length, texts };
  }).catch(() => ({ title: "", count: 0, texts: [] }));

  log("頁面標題：", data.title);
  log("article 數：", data.count);
  data.texts.forEach((t, i) => log(`\n──[${i}]──\n${t.slice(0, 400)}`));

  if (mode === "post") {
    if (!commentText) { log("post 模式需要留言內容"); await browser.close(); process.exit(1); }
    log("\n=== 準備張貼留言 ===\n", commentText);
    // 精準鎖定「這篇的留言/回答框」：aria 含 回答/留言/comment（排除建立貼文框）
    let box = null;
    const sels = [
      'div[contenteditable="true"][aria-label*="回答"]',
      'div[contenteditable="true"][aria-label*="留言"]',
      'div[contenteditable="true"][aria-label*="comment" i]',
      'div[role="textbox"][contenteditable="true"][aria-label*="回答"]',
    ];
    for (const s of sels) {
      const el = page.locator(s).first();
      if (await el.count().catch(() => 0)) { box = el; break; }
    }
    if (!box) { log("找不到留言輸入框（可能要先點『留言』或社團未加入）"); await browser.close(); process.exit(2); }
    await box.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await box.click().catch(() => {});
    await page.waitForTimeout(1000);
    // 用 insertText 一次插入整串（正確處理 unicode/emoji；type() 會把 emoji 打成亂碼）
    await page.keyboard.insertText(commentText);
    await page.waitForTimeout(1500);

    // ── 送出前先讀回輸入框實際內容，檢查亂碼 ──
    const typed = (await box.innerText().catch(() => "")) || (await box.textContent().catch(() => "")) || "";
    const norm = (s) => s.replace(/\s+/g, "");
    const okMatch = norm(typed) === norm(commentText);
    log("\n── 送出前讀回輸入框內容 ──");
    log(typed);
    log(`── 亂碼檢查：${okMatch ? "✅ 與預期完全一致" : "⚠️ 與預期不一致（下方比對）"} ──`);
    if (!okMatch) {
      log("預期：", commentText);
      log("實際：", typed);
      log("❌ 偵測到不一致（可能亂碼/漏字/emoji 損壞），為安全起見不送出。請看視窗。");
      await page.waitForTimeout(2500);
      await browser.close();
      process.exit(3);
    }

    // ── 內容乾淨才送出：只按一次 Enter 送出（不做任何「保險重送」，避免重複貼）──
    // FB 留言有讀取端傳播延遲，切勿在同一次執行內「驗不到就再送」，那會造成雙貼。
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);
    log("✅ 已送出一次（不重試）。請用 fb_verify.js 於稍後單獨驗證。");
    await page.waitForTimeout(2000);
  } else {
    log("\n(read 模式：未張貼任何留言)");
  }

  await browser.close();
  process.exit(0);
})();
