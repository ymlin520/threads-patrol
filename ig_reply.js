// ── Instagram 自動回覆腳本（給 IG 海巡命中的貼文留言）─────────────────
//
// ⚠️ 安全設計（與 reply.js 同一套思路）：
//   • 預設「乾跑模式」(dry-run)：只印出「會對哪篇、留什麼」，【不會實際送出】。
//   • 真的要送出，才加參數：  node ig_reply.js --live
//   • --max N 可限制本次篇數（測試時用 --max 1）。
//   • 已回覆過的記錄在 ig_replied.json、不重複回；每日配額記在 ig_reply_stats.json。
//   • 送出後會「驗證留言真的出現」才算成功；驗證不到不盲目重發
//     （IG/FB 留言有傳播延遲，重發風險是重複留言，寧可標成待確認）。
//
// 用法：
//   node ig_reply.js                  → 乾跑
//   node ig_reply.js --live --max 1   → 實際送出 1 篇

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { IG_CONFIG as CONFIG } from "./ig_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes("--live");
const FORCE_HOURS = process.argv.includes("--force-hours");
const maxArg = process.argv.indexOf("--max");
const authorArg = process.argv.indexOf("--author");
const TARGET_AUTHOR = authorArg > -1
  ? (process.argv[authorArg + 1] || "").replace(/^@/, "").toLowerCase()
  : "";
const log = (...a) => console.log("[ig-reply]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 內建範本（fallback；自動留言鐵則：純文字、無 emoji、無全形引號括號）
const REPLY_TEMPLATES = {
  "美食": [
    "這間默默收進口袋名單了，一看就是那種一吃會記住的店",
    "巷弄裡低調的店最迷人了，默默筆記，改天親自去吃一輪",
    "這種不浮誇但很有靈魂的店最對我胃口，收藏了",
  ],
  "旅遊": [
    "畫面好安靜好舒服，光看著心就慢下來了，收進口袋清單",
    "剛好最近想找地方放空，謝謝你分享，改天照著去走走",
    "這種走完心情會變好的地方最剛好了，先筆記起來",
  ],
  _default: [
    "謝謝你偷偷分享，這種口袋名單真的很珍貴，收好了",
    "跟著筆記了，有溫度的分享文最耐看",
  ],
};

// ── 執行參數（防封號保險，別調高）──────────────────
const MAX_REPLIES = maxArg > -1 ? Math.max(1, Number(process.argv[maxArg + 1]) || 1) : 3;
const DAILY_MAX = 6;
const DELAY_MIN = 120000;       // 每篇間隔最短 2 分鐘
const DELAY_MAX = 360000;       // 每篇間隔最長 6 分鐘
const ACTIVE_START = 9;
const ACTIVE_END = 23;
const REPLIED_LOG = path.join(__dirname, "ig_replied.json");
const STATS_LOG = path.join(__dirname, "ig_reply_stats.json");
// ──────────────────────────────────────────────────

function loadStats() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const s = JSON.parse(fs.readFileSync(STATS_LOG, "utf8"));
    return s.date === today ? s : { date: today, count: 0 };
  } catch { return { date: today, count: 0 }; }
}
function saveStats(s) { fs.writeFileSync(STATS_LOG, JSON.stringify(s), "utf8"); }

function loadHits() {
  const f = path.join(__dirname, "output", "ig_filtered_latest.json");
  if (!fs.existsSync(f)) {
    log("找不到 output/ig_filtered_latest.json，請先執行 node ig_patrol.js");
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

// A 方案：逐篇客製稿，沒有就回傳 null 走內建範本
// 兩個位置都找，根目錄優先（手改的客製稿蓋過 notify_telegram.js 自動配的）：
//   1. ig_replies_draft.json           由 Claude 讀原文逐篇生成
//   2. output/ig_replies_draft.json    notify_telegram.js 產出，與 Telegram 預覽一致
function loadDraft() {
  const candidates = [
    { file: path.join(__dirname, "ig_replies_draft.json"), source: "ig_replies_draft.json" },
    { file: path.join(__dirname, "output", "ig_replies_draft.json"), source: "output/ig_replies_draft.json" },
  ];
  for (const { file, source } of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(data) && data.length) return { data, source };
    } catch { /* 壞掉的檔案就跳過，換下一個位置 */ }
  }
  return null;
}

function replyFor(group) {
  return pick(REPLY_TEMPLATES[group] || REPLY_TEMPLATES._default);
}

// 送出前消毒（與 reply.js 同）：剝 emoji、引號括號、亂碼字元，NFC 正規化
function sanitizeReply(s) {
  return (s || "")
    .normalize("NFC")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[─-▟▯]/g, "")
    .replace(/[￼�]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[「」『』【】]/g, "")
    .replace(/[ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 關掉可能擋住畫面的跳窗（開啟通知、儲存登入資訊等）
async function dismissDialogs(page) {
  const labels = ["稍後再說", "以後再說", "略過", "Not Now", "Not now", "取消"];
  for (const t of labels) {
    try {
      const btn = page.getByRole("button", { name: t });
      if (await btn.count()) { await btn.first().click({ timeout: 1500 }); await page.waitForTimeout(800); }
    } catch {}
  }
}

// ── 對單一 IG 貼文送出留言 ──────────────────────────────
// 回傳 "verified"（送出且看到留言）或 "unverified"（送出了但還沒看到，不重發）
async function postComment(page, url, text) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await dismissDialogs(page);

  // 1) 留言框：IG 貼文頁是 <textarea>（aria-label 新增留言…）
  const commentBox = () => page.locator([
    "form textarea",
    "textarea",
    'input[placeholder*="留言"]',
    'input[placeholder*="comment" i]',
    '[contenteditable="true"][role="textbox"]',
  ].join(",")).first();
  let box = commentBox();
  if (!(await box.count())) {
    const commentButtons = [
      'button:has(svg[aria-label="留言"])',
      '[role="button"]:has(svg[aria-label="留言"])',
      'button:has(svg[aria-label="Comment"])',
      '[role="button"]:has(svg[aria-label="Comment"])',
      'svg[aria-label="留言"]',
      'svg[aria-label="Comment"]',
    ];
    for (const selector of commentButtons) {
      const trigger = page.locator(selector).first();
      if (await trigger.count()) {
        await trigger.click({ timeout: 4000 });
        await commentBox().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
        break;
      }
    }
    box = commentBox();
  }
  if (!(await box.count())) throw new Error("找不到留言輸入框");
  await box.click({ timeout: 4000 });
  await page.waitForTimeout(600);

  // 2) 輸入：insertText 一次整串送（IG 點擊後 textarea 會重新掛載，重新定位一次）
  box = page.locator([
    "textarea:focus",
    'input[placeholder*="留言"]:focus',
    'input[placeholder*="comment" i]:focus',
    '[contenteditable="true"][role="textbox"]:focus',
  ].join(",")).first();
  if (!(await box.count())) box = commentBox();
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1200);

  // 2.5) 亂碼守門：讀回輸入框實際內容比對，不一致就重打一次，再不行拒發
  const norm = (s) => (s || "").replace(/\s+/g, "");
  const readBack = async () => box.evaluate((el) => {
    if ("value" in el && el.value) return el.value;
    return el.innerText || el.textContent || "";
  }).catch(() => "");
  let typed = await readBack();
  if (norm(typed) !== norm(text)) {
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

  // 3) 送出：優先點「發佈/Post」按鈕，找不到就按 Enter
  let posted = false;
  for (const name of ["發佈", "Post", "发布"]) {
    try {
      const btn = page.getByRole("button", { name, exact: true });
      if (await btn.count()) { await btn.first().click({ timeout: 2500 }); posted = true; break; }
    } catch {}
  }
  if (!posted) await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);

  // 4) 驗證一：留言框清空
  const after = await commentBox().evaluate((el) => {
    if ("value" in el && el.value) return el.value;
    return el.innerText || el.textContent || "";
  }).catch(() => "");
  if (after && norm(after) === norm(text)) {
    throw new Error("送出後留言框沒清空，可能沒送出（不重試，請人工確認）");
  }

  // 5) 驗證二：頁面上找得到留言前 12 字（傳播有延遲，找不到就重整再看一次）
  const probe = text.slice(0, 12);
  const visible = async () =>
    (await page.getByText(probe, { exact: false }).count().catch(() => 0)) > 0;
  if (await visible()) return "verified";
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);
  if (await visible()) return "verified";
  return "unverified"; // 已送出但畫面上還沒看到——不重發，避免重複留言
}

(async () => {
  const replied = loadReplied();
  const draft = loadDraft();
  let useDraft = false;
  let queue;

  if (draft) {
    useDraft = true;
    queue = draft.data
      .filter((p) => p.url && p.reply && !replied.has(p.url))
      .filter((p) => !TARGET_AUTHOR || String(p.author || "").replace(/^@/, "").toLowerCase() === TARGET_AUTHOR)
      .slice(0, MAX_REPLIES);
  } else {
    const hits = loadHits();
    const seenAuthors = new Set();
    queue = hits
      .filter((p) => p.url && !replied.has(p.url))
      .filter((p) => !TARGET_AUTHOR || String(p.author || "").replace(/^@/, "").toLowerCase() === TARGET_AUTHOR)
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
  log(`資料來源：${useDraft ? `逐篇客製稿 ${draft.source}` : "內建範本 REPLY_TEMPLATES"}`);
  log(`本次處理 ${queue.length} 篇（上限 ${MAX_REPLIES}，已回覆過的略過）`);
  log("──────────────────────────────");

  if (!LIVE) {
    queue.forEach((p, i) => {
      log(`#${i + 1} [${p.group}] ${p.author}  (讚${p.likes}/留言${p.comments})`);
      if (p.content) log(`     原文：${p.content.slice(0, 42)}${p.content.length > 42 ? "…" : ""}`);
      log(`     ${p.url}`);
      log(`     ↪ 會留言：${textFor(p)}`);
    });
    log("──────────────────────────────");
    log("這是乾跑，沒有送出任何留言。確認 OK 後，用 node ig_reply.js --live 才會實際發。");
    process.exit(0);
  }

  // LIVE：三道保險
  const hour = new Date().getHours();
  if (!FORCE_HOURS && (hour < ACTIVE_START || hour >= ACTIVE_END)) {
    log(`⛔ 現在 ${hour} 點，不在安全時段（${ACTIVE_START}:00–${ACTIVE_END}:00），不執行`); process.exit(0);
  }
  const stats = loadStats();
  if (stats.count >= DAILY_MAX) {
    log(`⛔ 今日已留 ${stats.count} 篇，達每日上限 ${DAILY_MAX}，不執行`); process.exit(0);
  }
  const quota = Math.min(queue.length, DAILY_MAX - stats.count);
  if (quota < queue.length) {
    log(`今日剩餘配額 ${quota} 篇，只處理前 ${quota} 篇`);
    queue.length = quota;
  }
  if (!fs.existsSync(path.join(__dirname, CONFIG.AUTH_FILE))) {
    log("找不到 ig_auth_state.json，請先 node ig_auth.js"); process.exit(1);
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
    log(`     ↪ 留言：${text}`);
    try {
      const result = await postComment(page, p.url, text);
      replied.add(p.url); saveReplied(replied);
      ok++;
      stats.count++; saveStats(stats);
      if (result === "verified") log(`     ✅ 已送出且在頁面上驗證到留言（今日 ${stats.count}/${DAILY_MAX}）`);
      else log(`     🟡 已送出但頁面上還沒看到（傳播延遲，不重發，請稍後人工確認）`);
    } catch (e) {
      log("     ⚠️ 失敗：", e.message);
      await page.screenshot({
        path: path.join(__dirname, "output", "ig_reply_error.png"),
        fullPage: true,
      }).catch(() => {});
    }
    if (i < queue.length - 1) {
      const wait = rnd(DELAY_MIN, DELAY_MAX);
      log(`     ⏳ 等 ${Math.round(wait / 1000)} 秒再留下一篇...`);
      await page.waitForTimeout(wait);
    }
  }

  await browser.close();
  log(`──────── 完成：成功 ${ok}/${queue.length} 篇 ────────`);
  process.exit(0);
})();
