// ── Facebook 一次性登入：開瀏覽器手動登入，偵測到登入後自動存狀態 ──
// 用法：npm run fb-auth  （會跳出瀏覽器，請在裡面登入你的 FB 帳號）

import { chromium } from "playwright";
import { FB_CONFIG } from "./fb_config.js";

const LOGIN_URL = `${FB_CONFIG.BASE_URL}/login`;
const MAX_WAIT_MS = 5 * 60 * 1000; // 最多等 5 分鐘讓你登入

const log = (...a) => console.log("[fb-auth]", ...a);

// 只看 c_user 不夠：FB 的「選擇帳號／繼續以…身分登入」畫面就已經帶 c_user 了，
// 那時存檔會得到一份看似有 cookie、實際未登入的 session（爬蟲會全部抓 0 篇）。
// 所以 cookie 齊了之後，還要實際開一次首頁確認真的進得去動態消息。
async function hasAuthCookies(context) {
  const cookies = await context.cookies();
  const has = (n) => cookies.some((c) => c.name === n && c.value);
  return has("c_user") && has("xs");
}

// 回傳 null 代表已登入；回傳字串代表還沒好（字串是原因，給使用者看）
async function whyNotLoggedIn(page) {
  await page.goto(`${FB_CONFIG.BASE_URL}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const txt = (document.body.innerText || "").replace(/\s+/g, " ");
    if (document.querySelector('input[name="pass"], input[name="email"]')) {
      return "頁面上還有登入表單";
    }
    if (/繼續|使用其他個人檔案|Continue as|Log into another account/i.test(txt.slice(0, 400))) {
      return "停在「選擇帳號／繼續」畫面，請點進去完成登入";
    }
    if (/checkpoint|驗證你的身分|確認你的身分|Temporarily Blocked|暫時被封鎖/i.test(txt)) {
      return "FB 要求安全驗證（checkpoint），請在視窗中完成";
    }
    // 已登入的首頁一定有搜尋框或建立貼文入口，且內容量遠大於登入頁
    const loggedInUi =
      document.querySelector('[aria-label="搜尋 Facebook"], [aria-label="Search Facebook"]') ||
      document.querySelector('div[role="feed"], div[role="main"] div[role="article"]');
    if (!loggedInUi && txt.length < 1000) return "首頁內容過少，看起來還沒真的登入";
    return null;
  }).catch((e) => "檢查頁面失敗：" + e.message);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  log("開啟登入頁，請在視窗中手動登入你的 Facebook 帳號…");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  const start = Date.now();
  let logged = false;
  let lastReason = "還沒偵測到 c_user / xs cookie";

  while (Date.now() - start < MAX_WAIT_MS) {
    if (await hasAuthCookies(context)) {
      const reason = await whyNotLoggedIn(page);
      if (reason === null) { logged = true; break; }
      if (reason !== lastReason) { log("⏳", reason); lastReason = reason; }
    }
    await page.waitForTimeout(3000);
  }

  if (!logged) {
    log(`等了 5 分鐘還沒完成登入（最後狀態：${lastReason}），先關閉。`);
    log("請重新執行 npm run fb-auth，並確認有真的進到動態消息頁面。");
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: FB_CONFIG.AUTH_FILE });
  log("✅ 已驗證真的登入，狀態存到", FB_CONFIG.AUTH_FILE, "— 現在可以執行 npm run fb-patrol");
  await page.waitForTimeout(1500);
  await browser.close();
  process.exit(0);
})();
