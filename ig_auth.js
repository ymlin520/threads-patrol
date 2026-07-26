// ── 一次性登入：開瀏覽器讓你手動登入 IG，偵測到登入後自動存下狀態 ──────
// 用法：npm run ig-auth   （會跳出瀏覽器視窗，請在裡面登入 @eat.map.journal）

import { chromium } from "playwright";
import { IG_CONFIG } from "./ig_config.js";

const LOGIN_URL = `${IG_CONFIG.BASE_URL}/accounts/login/`;
const MAX_WAIT_MS = 5 * 60 * 1000; // 最多等 5 分鐘讓你登入

function log(...a) { console.log("[ig-auth]", ...a); }

async function isLoggedIn(context) {
  const cookies = await context.cookies();
  // Instagram 登入後會有 sessionid cookie
  const sid = cookies.find(
    (c) => c.name === "sessionid" && c.value && c.value.length > 0
  );
  return Boolean(sid);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: IG_CONFIG.CHANNEL });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  log("開啟 IG 登入頁，請在視窗中手動登入小帳號：@" + IG_CONFIG.TARGET_ACCOUNT);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  const start = Date.now();
  let logged = false;
  while (Date.now() - start < MAX_WAIT_MS) {
    if (await isLoggedIn(context)) { logged = true; break; }
    await page.waitForTimeout(2500);
  }

  if (!logged) {
    log("等了 5 分鐘還沒偵測到登入，先關閉。請重新執行 npm run ig-auth。");
    await browser.close();
    process.exit(1);
  }

  // 登入偵測到後多等幾秒，讓「儲存登入資訊」等跳窗處理完、cookie 寫齊
  await page.waitForTimeout(5000);
  await context.storageState({ path: IG_CONFIG.AUTH_FILE });
  log("✅ 登入狀態已存到", IG_CONFIG.AUTH_FILE, "— 現在可以執行 npm run ig-patrol");
  await page.waitForTimeout(1500);
  await browser.close();
  process.exit(0);
})();
