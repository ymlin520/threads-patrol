// ── Instagram 海巡主程式 ──────────────────────────────────────────
// 用法：npm run ig-patrol   （需先 npm run ig-auth 存好 ig_auth_state.json）
//
// 策略：用登入狀態開瀏覽器 → 逐一到 IG 關鍵字搜尋頁 → 捲動，
//       同時攔截 IG 的 GraphQL/API JSON 回應，從中抽出結構化貼文資料。
//       IG 與 Threads 的 API 貼文節點同源（code / like_count / caption），
//       所以 harvest 邏輯與 patrol.js 一致，只差留言數欄位與貼文網址格式。

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { IG_CONFIG as CONFIG, RELEVANCE_KEYWORDS } from "./ig_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = CONFIG.BASE_URL;
const log = (...a) => console.log("[ig-patrol]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

// 全域收集：code -> post
const posts = new Map();
let capturing = false;   // 驗證帳號階段不收集，避免污染主題計數
let currentGroup = "";   // 目前正在抓的主題（美食 / 旅遊）

const groupCount = (g) =>
  [...posts.values()].filter((p) => p.group === g).length;

// 清掉亂碼／特殊符號（與 patrol.js 同）
function cleanText(s) {
  return (s || "")
    .replace(/[─-▟]/g, "")
    .replace(/[￼�]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 從任意 JSON 遞迴抽出「看起來是貼文」的節點 ──────────────────
function harvest(node, depth = 0) {
  if (!capturing) return;
  if (!node || depth > 40) return;
  if (Array.isArray(node)) {
    for (const x of node) harvest(x, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  const looksLikePost =
    typeof node.code === "string" &&
    typeof node.like_count === "number" &&
    (node.pk !== undefined || node.id !== undefined);

  if (looksLikePost && !posts.has(node.code)) {
    const username = node.user?.username ?? node.owner?.username ?? "";
    const text = node.caption?.text ?? node.text ?? "";
    const likes = node.like_count ?? 0;
    const comments = node.comment_count ?? node.reply_count ?? 0;
    const takenAt = node.taken_at ?? node.taken_at_ts ?? null;
    const postedAt = takenAt ? new Date(takenAt * 1000).toISOString() : "";
    // IG 貼文網址：Reels 用 /reel/、一般貼文用 /p/
    const isReel = node.product_type === "clips" || node.media_type === 2;
    const url = `${BASE}/${isReel ? "reel" : "p"}/${node.code}/`;

    posts.set(node.code, {
      group: currentGroup,
      author: username ? "@" + username : "",
      content: cleanText(text),
      likes: Number(likes) || 0,
      comments: Number(comments) || 0,
      posted_at: postedAt,
      url,
    });
  }

  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") harvest(v, depth + 1);
  }
}

async function verifyAccount(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);
  // 從導覽列找登入者自己的 profile 連結
  const handles = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('a[href^="/"]').forEach((a) => {
      const m = a.getAttribute("href").match(/^\/([A-Za-z0-9._]+)\/$/);
      if (m) set.add(m[1]);
    });
    return [...set];
  }).catch(() => []);

  if (handles.includes(CONFIG.TARGET_ACCOUNT)) {
    log(`✅ 已確認登入帳號包含目標 @${CONFIG.TARGET_ACCOUNT}`);
    return true;
  }
  log(`⚠️ 頁面上沒明確看到 @${CONFIG.TARGET_ACCOUNT}（偵測到：${handles.slice(0, 8).join(", ") || "無"}）。`);
  log("   仍會繼續，但請確認你登入的是正確的小帳號。");
  return false;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(file, rows) {
  const cols = ["group","author","content","likes","comments","posted_at","url","relevant","hit","hit_reason"];
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  fs.writeFileSync(file, "﻿" + lines.join("\n"), "utf8"); // BOM 讓 Excel 中文不亂碼
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

(async () => {
  if (!fs.existsSync(path.join(__dirname, CONFIG.AUTH_FILE))) {
    log("找不到 ig_auth_state.json，請先執行：npm run ig-auth"); process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, channel: CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: CONFIG.AUTH_FILE,
    viewport: { width: 1280, height: 900 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  // 攔截所有 JSON 回應
  page.on("response", async (resp) => {
    try {
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("application/json")) return;
      const u = resp.url();
      if (!/graphql|\/api\/|search|feed|serp|sections|tags/i.test(u)) return;
      const data = await resp.json();
      harvest(data);
    } catch {}
  });

  await verifyAccount(page);

  capturing = true; // 驗證完才開始收集
  const target = CONFIG.PER_GROUP_TARGET;
  for (const [gname, kws] of Object.entries(CONFIG.KEYWORD_GROUPS)) {
    currentGroup = gname;
    log(`===== 主題「${gname}」開始（目標 ${target} 篇）=====`);
    for (let i = 0; i < kws.length; i++) {
      if (groupCount(gname) >= target) break;
      const kw = kws[i];
      // IG 關鍵字搜尋結果頁（登入後可用）
      const searchUrl = `${BASE}/explore/search/keyword/?q=${encodeURIComponent(kw)}`;
      log(`  [${gname} ${i+1}/${kws.length}] 搜尋「${kw}」  (本主題已 ${groupCount(gname)} 篇)`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(3500);

      for (let s = 0; s < CONFIG.SCROLLS_PER_KEYWORD; s++) {
        if (groupCount(gname) >= target) break;
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await page.waitForTimeout(rnd(CONFIG.SCROLL_DELAY_MIN, CONFIG.SCROLL_DELAY_MAX));
      }
    }
    log(`===== 主題「${gname}」收集 ${groupCount(gname)} 篇 =====`);
  }

  await browser.close();

  // ── 篩選 ────────────────────────────────────────────────
  const all = [...posts.values()];
  for (const p of all) {
    const relevant = RELEVANCE_KEYWORDS.some((k) => p.content.includes(k));
    const f = CONFIG.GROUP_FILTERS[p.group] || CONFIG.DEFAULT_FILTER;
    p.relevant = relevant;
    p.hit = relevant && p.likes >= f.LIKES_MIN && p.comments >= f.COMMENTS_MIN;
    p.hit_reason = p.hit ? `讚${p.likes}/留言${p.comments}` : "";
  }

  const filtered = all
    .filter((p) => p.hit)
    .sort((a, b) => (a.group === b.group ? b.likes - a.likes : a.group < b.group ? -1 : 1));

  const tag = stamp();
  const rawFile = path.join(__dirname, "output", `ig_raw_${tag}.csv`);
  const hitFile = path.join(__dirname, "output", `ig_filtered_${tag}.csv`);
  writeCsv(rawFile, all);
  writeCsv(hitFile, filtered);
  // 額外輸出 JSON（固定檔名方便讀取最新一批命中）
  fs.writeFileSync(
    path.join(__dirname, "output", "ig_filtered_latest.json"),
    JSON.stringify(filtered, null, 2), "utf8"
  );

  log("──────── 完成 ────────");
  for (const g of Object.keys(CONFIG.KEYWORD_GROUPS)) {
    const f = CONFIG.GROUP_FILTERS[g] || CONFIG.DEFAULT_FILTER;
    log(`主題「${g}」：抓 ${groupCount(g)} 篇，命中 ${filtered.filter(p=>p.group===g).length} 篇  (門檻 讚≥${f.LIKES_MIN}/留言≥${f.COMMENTS_MIN})`);
  }
  log(`合計抓到 ${all.length} 篇，命中 ${filtered.length} 篇`);
  log("原始檔：", rawFile);
  log("命中檔：", hitFile);
  process.exit(0);
})();
