// ── Threads 自動回覆腳本（給海巡命中的貼文回覆）─────────────────────
//
// ⚠️ 安全設計：
//   • 預設「乾跑模式」(dry-run)：只印出「會對哪篇、回覆什麼」，【不會實際送出】。
//   • 真的要送出，才加參數：  node reply.js --live
//   • 每次執行上限 MAX_REPLIES 篇，且已回覆過的會記錄在 replied.json、不重複回。
//
// 用法：
//   node reply.js            → 乾跑，看看會回什麼（不送）
//   node reply.js --live     → 真的送出（你自己確認範本後再用）

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes("--live"); // 沒帶 --live 就是乾跑
const log = (...a) => console.log("[reply]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ══════════════════════════════════════════════════════════════════
// ✏️ 回覆範本（依主題分開，會隨機挑一句）
//    口氣依 .claude/skills/eat-map-reply/SKILL.md 的「本人語氣」改寫：
//    溫暖、真誠、像朋友、不像業配。要更貼近單篇內容時，改走 A 方案
//    （讓 Claude 讀 filtered_latest.json 逐篇客製，帶入對方店名／食物）。
// ══════════════════════════════════════════════════════════════════
const REPLY_TEMPLATES = {
  "美食": [
    "這間我收進口袋名單了🥹 一看就是那種一吃會記住的店",
    "被你燒到了啦～這種不浮誇但很有靈魂的店最對我胃口✨",
    "巷弄裡低調的店最迷人了，默默筆記📍 改天親自去吃一輪",
    "看起來就是乾淨、溫暖、吃得安心的那種，收藏了🔖",
    "這種「沒事不會經過、但一去就會上癮」的店，謝謝你偷偷分享🙏",
  ],
  "旅遊": [
    "畫面好安靜好舒服🌊 光看著心就慢下來了，收進口袋清單",
    "剛好最近想找地方放空，謝謝你分享，改天照著去走走🌿",
    "這種走完心情會變好的地方最剛好了，先筆記起來✨",
    "不用去很遠，這種轉個彎就是風景的路最療癒了🥾",
  ],
  _default: [
    "謝謝你偷偷分享🥹 這種口袋名單真的很珍貴，收好了",
    "跟著筆記了🔖 有溫度的分享文最耐看，感謝你🙏",
  ],
};

// ── 執行參數（防封號保險，別調高）──────────────────
const MAX_REPLIES = 4;          // 單次執行上限（一口氣回太多最危險）
const DAILY_MAX = 6;            // 每日總上限（跨次數累計，記在 reply_stats.json）
const DELAY_MIN = 120000;       // 每篇間隔最短 2 分鐘
const DELAY_MAX = 360000;       // 每篇間隔最長 6 分鐘（隨機，模擬真人）
const ACTIVE_START = 9;         // 只在 09:00–23:00 執行（真人作息）
const ACTIVE_END = 23;
const REPLIED_LOG = path.join(__dirname, "replied.json");
const STATS_LOG = path.join(__dirname, "reply_stats.json");
// ──────────────────────────────────────────────────

// 每日配額：{ date: "YYYY-MM-DD", count: n }
function loadStats() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const s = JSON.parse(fs.readFileSync(STATS_LOG, "utf8"));
    return s.date === today ? s : { date: today, count: 0 };
  } catch { return { date: today, count: 0 }; }
}
function saveStats(s) { fs.writeFileSync(STATS_LOG, JSON.stringify(s), "utf8"); }

function loadHits() {
  const f = path.join(__dirname, "output", "filtered_latest.json");
  if (!fs.existsSync(f)) {
    log("找不到 output/filtered_latest.json，請先執行 node patrol.js");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function loadReplied() {
  try { return new Set(JSON.parse(fs.readFileSync(REPLIED_LOG, "utf8"))); }
  catch { return new Set(); }
}
function saveReplied(set) {
  fs.writeFileSync(REPLIED_LOG, JSON.stringify([...set], null, 2), "utf8");
}

// A 方案：逐篇客製稿（由 Claude 讀原文生成），沒有就回傳 null 走內建範本
function loadDraft() {
  const f = path.join(__dirname, "replies_draft.json");
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

function replyFor(group) {
  return pick(REPLY_TEMPLATES[group] || REPLY_TEMPLATES._default);
}

// 送出前消毒：清掉會變亂碼的字元（方塊/框線、取代字元、物件字元、零寬、控制字元、引號括號）
// 並「剝除所有 emoji」——自動留言一律純文字，從根源避免 emoji 亂碼。
function sanitizeReply(s) {
  return (s || "")
    .normalize("NFC")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")  // emoji 主區（表情、食物、旗幟、膚色等）
    .replace(/[\u{2600}-\u{27BF}]/gu, "")    // 雜項符號＋裝飾符號 ☀✨✔❤
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")    // 雜項符號箭頭 ⭐⬇
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")    // 變體選擇子（emoji 化尾碼）
    .replace(/[─-▟▯]/g, "")       // 框線／方塊亂碼
    .replace(/[￼�]/g, "")          // ￼ 物件字元、� 取代字元
    .replace(/[​-‍﻿]/g, "")   // 零寬字元（含 ZWJ）
    .replace(/[「」『』【】]/g, "")   // 全形引號括號（在留言框易顯示異常，改用語意表達）
    .replace(/[ -]/g, " ")  // 控制字元
    .replace(/\s+/g, " ")
    .trim();
}

// ── 對單一貼文送出回覆（best-effort，selector 以實際頁面為準）──────
async function postReply(page, url, text) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  // 1) 內嵌回覆框（contenteditable）— 直接點擊聚焦
  let box = page.locator('[contenteditable="true"]').first();
  if (!(await box.count())) box = page.getByRole("textbox").first();
  if (!(await box.count())) throw new Error("找不到回覆輸入框");
  await box.click({ timeout: 3000 });

  // 2) 輸入內容：用 insertText 一次整串送（emoji/雙碼位才不會變方塊亂碼）
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1200);

  // 2.5) 亂碼守門（參考 fb_comment.js）：讀回輸入框實際內容比對，不一致就重打一次，再不行就拒發
  const norm = (s) => (s || "").replace(/\s+/g, "");
  const readBack = async () =>
    (await box.innerText().catch(() => "")) || (await box.textContent().catch(() => "")) || "";
  let typed = await readBack();
  if (norm(typed) !== norm(text)) {
    // 清空重打一次
    await box.click({ timeout: 3000 }).catch(() => {});
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(600);
    await page.keyboard.insertText(text);
    await page.waitForTimeout(1200);
    typed = await readBack();
  }
  if (norm(typed) !== norm(text)) {
    throw new Error(`亂碼檢查失敗，拒絕送出（框內：${typed.slice(0, 50)}…）`);
  }

  // 3) 送出：Threads 內嵌回覆用 Ctrl+Enter（實測可用）
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(3500);

  // 4) 驗證：回覆框清空＝送出成功
  let cleared = true;
  try {
    const t = (await page.locator('[contenteditable="true"]').first().innerText()) || "";
    cleared = t.trim().length === 0;
  } catch {}
  if (!cleared) throw new Error("送出後回覆框未清空，可能未送出");
  return true;
}

(async () => {
  const replied = loadReplied();
  const draft = loadDraft();
  let useDraft = false;
  let queue;

  if (draft && draft.length) {
    // A 方案：逐篇客製稿（已排序＋去重，直接照順序用）
    useDraft = true;
    queue = draft
      .filter((p) => p.url && p.reply && !replied.has(p.url))
      .slice(0, MAX_REPLIES);
  } else {
    // B 方案（fallback）：沒客製稿時用內建範本，依互動數高→低、同作者最多 1 篇
    const hits = loadHits();
    const seenAuthors = new Set();
    queue = hits
      .filter((p) => p.url && !replied.has(p.url))
      .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
      .filter((p) => {
        if (seenAuthors.has(p.author)) return false;
        seenAuthors.add(p.author);
        return true;
      })
      .slice(0, MAX_REPLIES);
  }
  const textFor = (p) => sanitizeReply(useDraft ? p.reply : replyFor(p.group));

  log(`模式：${LIVE ? "🔴 LIVE（會實際送出）" : "🟢 乾跑（不送出）"}`);
  log(`資料來源：${useDraft ? "逐篇客製稿 replies_draft.json" : "內建範本 REPLY_TEMPLATES"}`);
  log(`本次處理 ${queue.length} 篇（上限 ${MAX_REPLIES}，已回覆過的略過）`);
  log("──────────────────────────────");

  if (!LIVE) {
    // 乾跑：只印出會回什麼，不開瀏覽器、不送出
    queue.forEach((p, i) => {
      log(`#${i + 1} [${p.group}${p.type ? "/" + p.type : ""}] ${p.author}  (讚${p.likes}/留言${p.comments})`);
      if (p.content) log(`     原文：${p.content.slice(0, 42)}${p.content.length > 42 ? "…" : ""}`);
      log(`     ${p.url}`);
      log(`     ↪ 會回覆：「${textFor(p)}」`);
    });
    log("──────────────────────────────");
    log("這是乾跑，沒有送出任何回覆。確認範本 OK 後，用 node reply.js --live 才會實際發。");
    process.exit(0);
  }

  // LIVE：實際送出 —— 先過三道保險
  const hour = new Date().getHours();
  if (hour < ACTIVE_START || hour >= ACTIVE_END) {
    log(`⛔ 現在 ${hour} 點，不在安全時段（${ACTIVE_START}:00–${ACTIVE_END}:00），不執行`); process.exit(0);
  }
  const stats = loadStats();
  if (stats.count >= DAILY_MAX) {
    log(`⛔ 今日已回 ${stats.count} 篇，達每日上限 ${DAILY_MAX}，不執行`); process.exit(0);
  }
  const quota = Math.min(queue.length, DAILY_MAX - stats.count);
  if (quota < queue.length) {
    log(`今日剩餘配額 ${quota} 篇，只處理前 ${quota} 篇`);
    queue.length = quota;
  }
  if (!fs.existsSync(path.join(__dirname, CONFIG.AUTH_FILE))) {
    log("找不到 auth_state.json，請先 node auth_setup.js"); process.exit(1);
  }
  const browser = await chromium.launch({ headless: false, channel: CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: CONFIG.AUTH_FILE, viewport: { width: 1280, height: 900 }, locale: "zh-TW",
  });
  const page = await context.newPage();

  let ok = 0;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const text = textFor(p);
    log(`#${i + 1}/${queue.length} [${p.group}] ${p.url}`);
    log(`     ↪ 回覆：「${text}」`);
    try {
      await postReply(page, p.url, text);
      replied.add(p.url); saveReplied(replied);
      ok++;
      stats.count++; saveStats(stats);   // 記入每日配額
      log(`     ✅ 已送出（今日 ${stats.count}/${DAILY_MAX}）`);
    } catch (e) {
      log("     ⚠️ 失敗：", e.message);
    }
    if (i < queue.length - 1) {
      const wait = rnd(DELAY_MIN, DELAY_MAX);
      log(`     ⏳ 等 ${Math.round(wait / 1000)} 秒再回下一篇...`);
      await page.waitForTimeout(wait);
    }
  }

  await browser.close();
  log(`──────── 完成：成功 ${ok}/${queue.length} 篇 ────────`);
  process.exit(0);
})();
