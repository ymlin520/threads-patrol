// 單篇測試回覆：對指定貼文送出一則留言，每步截圖 + 發後驗證
// 用法：node test_reply.js [貼文網址] [回覆內容]
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "output");
const log = (...a) => console.log("[test]", ...a);

const TARGET_URL = process.argv[2] || "https://www.threads.com/@lena____910828/post/Da8DTJRGK8B";
const REPLY_TEXT = process.argv[3] || "不用浮誇造型、單純布丁或水果的反而最耐吃🥹 我也偏愛那種不靠裝飾、味道扎實的私藏蛋糕店～你是找哪一區的？1000內其實藏著不少低調寶藏🍰";
const VERIFY_SNIPPET = REPLY_TEXT.slice(0, 16);
const VERIFY_ONLY = process.argv.includes("--verify-only");

const shot = async (page, name) => {
  const f = path.join(OUT, `cake_test_${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  log("截圖:", f);
};

(async () => {
  const browser = await chromium.launch({ headless: false, channel: CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: CONFIG.AUTH_FILE, viewport: { width: 1280, height: 950 }, locale: "zh-TW",
  });
  const page = await context.newPage();

  log("開啟目標貼文:", TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await shot(page, "1_open");

  if (VERIFY_ONLY) {
    try {
      const sort = page.getByText(/熱門|最相關/, { exact: true }).first();
      if (await sort.count()) await sort.click({ timeout: 2500 });
      await page.waitForTimeout(800);
      const recent = page.getByText(/最新|近期/, { exact: true }).first();
      if (await recent.count()) await recent.click({ timeout: 2500 });
    } catch {}
    await page.waitForTimeout(2500);
    const found = await page.getByText(VERIFY_SNIPPET, { exact: false }).count().catch(() => 0);
    await shot(page, "verify_only");
    log(found > 0 ? `✅ 驗證成功：頁面上找到留言（含「${VERIFY_SNIPPET}」）` : "⚠️ 最新排序仍未找到留言，請人工確認；不會重送");
    await browser.close();
    process.exit(found > 0 ? 0 : 2);
  }

  const duplicate = await page.getByText(REPLY_TEXT, { exact: true }).count().catch(() => 0);
  if (duplicate) {
    log("↪ 頁面已有相同回覆，略過以避免重複留言");
    await browser.close();
    process.exit(0);
  }

  // 1) 開啟回覆框：先試點「回覆」觸發區
  let opened = false;
  for (const n of ["回覆", "留言", "Reply"]) {
    try {
      const el = page.getByText(n, { exact: true }).first();
      if (await el.count()) { await el.click({ timeout: 3000 }); opened = true; log("點開回覆:", n); break; }
    } catch {}
  }
  await page.waitForTimeout(2500);
  await shot(page, "2_composer");

  // 2) 找輸入框並打字
  let box = page.locator('[contenteditable="true"]').first();
  if (!(await box.count())) box = page.getByRole("textbox").first();
  if (!(await box.count())) { log("❌ 找不到輸入框，中止"); await shot(page, "err_nobox"); await browser.close(); process.exit(1); }
  await box.click({ timeout: 3000 });
  await page.keyboard.insertText(REPLY_TEXT); // insertText：emoji 才不會變方塊亂碼
  await page.waitForTimeout(1500);
  await shot(page, "3_typed");

  // 亂碼守門（fb_comment.js 模式）：讀回輸入框實際內容比對，不一致就不送
  const norm = (s) => (s || "").replace(/\s+/g, "");
  const typed = (await box.innerText().catch(() => "")) || (await box.textContent().catch(() => "")) || "";
  log("讀回框內內容:", typed);
  if (norm(typed) !== norm(REPLY_TEXT)) {
    log("❌ 亂碼檢查不一致，拒絕送出。預期:", REPLY_TEXT);
    await shot(page, "err_garbled");
    await browser.close(); process.exit(3);
  }
  log("✅ 亂碼檢查通過，內容一致");

  // 3) 送出：Threads 內嵌回覆用 Ctrl+Enter 送出
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(3500);
  await shot(page, "4_after_ctrlenter");

  // 檢查回覆框是否已清空（清空＝送出成功）；沒清空就改點圓形箭頭送出鈕
  let stillHasText = false;
  try { stillHasText = (await page.locator('[contenteditable="true"]').first().innerText()).includes(VERIFY_SNIPPET); } catch {}
  if (stillHasText) {
    log("Ctrl+Enter 未送出，改點送出 icon 鈕...");
    let clicked = false;
    for (const sel of ['[aria-label="發佈"]','[aria-label="發布"]','svg[aria-label="發佈"]','svg[aria-label="Post"]','div[role="button"][aria-label*="發"]']) {
      try { const el = page.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 3000 }); clicked = true; log("點了送出鈕:", sel); break; } } catch {}
    }
    if (!clicked) { log("❌ 仍找不到送出鈕，未送出，請看截圖"); await shot(page, "err_nobtn"); await browser.close(); process.exit(1); }
    await page.waitForTimeout(3500);
    await shot(page, "4b_after_btn");
  }

  // 4) 驗證：重載頁面，看留言文字是否出現
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const found = await page.getByText(VERIFY_SNIPPET, { exact: false }).count().catch(() => 0);
  await shot(page, "5_verify");
  log(found > 0 ? `✅ 驗證成功：頁面上找到留言（含「${VERIFY_SNIPPET}」）` : "⚠️ 重載後沒抓到留言文字，請看截圖 5_verify 確認");

  await browser.close();
  process.exit(0);
})();
