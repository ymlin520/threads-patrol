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

// ── 執行參數（可調）───────────────────────────────
const MAX_REPLIES = 8;          // 每次執行最多回覆幾篇（保守，避免被風控）
const DELAY_MIN = 25000;        // 每篇之間最短間隔（ms）
const DELAY_MAX = 60000;        // 每篇之間最長間隔（ms）
const REPLIED_LOG = path.join(__dirname, "replied.json");
// ──────────────────────────────────────────────────

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

// ── 對單一貼文送出回覆（best-effort，selector 以實際頁面為準）──────
async function postReply(page, url, text) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 1) 點開回覆框（回覆/留言/Reply）
  const openNames = ["回覆", "留言", "Reply"];
  let opened = false;
  for (const n of openNames) {
    try {
      const el = page.getByText(n, { exact: false }).first();
      if (await el.count()) { await el.click({ timeout: 3000 }); opened = true; break; }
    } catch {}
  }
  await page.waitForTimeout(1500);

  // 2) 找到輸入框（contenteditable / textbox）並打字
  let box = page.locator('[contenteditable="true"]').first();
  if (!(await box.count())) box = page.getByRole("textbox").first();
  if (!(await box.count())) throw new Error("找不到回覆輸入框");
  await box.click({ timeout: 3000 });
  await box.type(text, { delay: 40 });
  await page.waitForTimeout(1200);

  // 3) 送出（發佈/Post）
  const postNames = ["發佈", "發布", "Post", "張貼"];
  for (const n of postNames) {
    try {
      const btn = page.getByRole("button", { name: n }).first();
      if (await btn.count() && await btn.isEnabled()) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(2500);
        return true;
      }
    } catch {}
  }
  throw new Error("找不到可用的送出按鈕");
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
  const textFor = (p) => (useDraft ? p.reply : replyFor(p.group));

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

  // LIVE：實際送出
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
      log("     ✅ 已送出");
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
