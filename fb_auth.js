// ── Facebook 一次性登入：開瀏覽器手動登入，偵測到登入後自動存狀態 ──
// 用法：npm run fb-auth  （會跳出瀏覽器，請在裡面登入你的 FB 帳號）

import { chromium } from "playwright";
import { FB_CONFIG } from "./fb_config.js";

const LOGIN_URL = `${FB_CONFIG.BASE_URL}/login`;
const MAX_WAIT_MS = 5 * 60 * 1000; // 最多等 5 分鐘讓你登入

const log = (...a) => console.log("[fb-auth]", ...a);

async function isLoggedIn(context) {
  const cookies = await context.cookies();
  // FB 登入後會有 c_user（使用者 id）與 xs cookie
  const cUser = cookies.find((c) => c.name === "c_user" && c.value);
  return Boolean(cUser);
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
  while (Date.now() - start < MAX_WAIT_MS) {
    if (await isLoggedIn(context)) { logged = true; break; }
    await page.waitForTimeout(2500);
  }

  if (!logged) {
    log("等了 5 分鐘還沒偵測到登入，先關閉。請重新執行 npm run fb-auth。");
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: FB_CONFIG.AUTH_FILE });
  log("✅ 登入狀態已存到", FB_CONFIG.AUTH_FILE, "— 現在可以執行 npm run fb-patrol");
  await page.waitForTimeout(1500);
  await browser.close();
  process.exit(0);
})();
