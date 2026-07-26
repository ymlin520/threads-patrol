// ── Facebook 美食熱門貼文爬蟲主程式 ─────────────────────────────
// 用法：npm run fb-patrol   （需先 npm run fb-auth 存好 fb_auth_state.json）
//
// 策略（跟 Threads 海巡同一套）：用登入狀態開瀏覽器 → 逐一搜尋美食關鍵字
//   → 捲動 → 攔截 FB 的 GraphQL JSON 回應，遞迴抽出結構化貼文
//   （作者/內文/讚數/留言數/時間/連結）。FB 的 JSON 巢狀很深，
//   這裡用「遞迴找 Story 節點 + 就近抓文字與互動數」的啟發式做法。

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FB_CONFIG, FB_RELEVANCE_KEYWORDS } from "./fb_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = FB_CONFIG.BASE_URL;
const log = (...a) => console.log("[fb-patrol]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

const posts = new Map(); // post_id -> post
let capturing = false;

// 遞迴在節點內找第一個 message.text（貼文內文）
function firstMessageText(node, depth = 0) {
  if (!node || depth > 25 || typeof node !== "object") return "";
  if (node.message && typeof node.message === "object" &&
      typeof node.message.text === "string" && node.message.text.trim()) {
    return node.message.text;
  }
  // 有些內文放在 comet_sections.content.story.message.text，上面那條就能命中
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") {
      const r = firstMessageText(v, depth + 1);
      if (r) return r;
    }
  }
  return "";
}

// 遞迴找數值型互動數：支援 number / 字串數字 / {count} / {total_count}
function findCount(node, keyNames, depth = 0) {
  if (!node || depth > 25 || typeof node !== "object") return null;
  for (const kn of keyNames) {
    if (Object.prototype.hasOwnProperty.call(node, kn)) {
      const v = node[kn];
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const m = v.replace(/[^\d]/g, "");
        if (m) return parseInt(m, 10);
      }
      if (v && typeof v === "object") {
        if (typeof v.count === "number") return v.count;
        if (typeof v.total_count === "number") return v.total_count;
      }
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") {
      const r = findCount(v, keyNames, depth + 1);
      if (r != null) return r;
    }
  }
  return null;
}

// 遞迴找作者名稱（actors[0].name 或 owner.name）
function firstActorName(node, depth = 0) {
  if (!node || depth > 20 || typeof node !== "object") return "";
  if (Array.isArray(node.actors) && node.actors[0]?.name) return node.actors[0].name;
  if (node.owner && typeof node.owner.name === "string") return node.owner.name;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") {
      const r = firstActorName(v, depth + 1);
      if (r) return r;
    }
  }
  return "";
}

// 遞迴找貼文連結
function firstUrl(node, depth = 0) {
  if (!node || depth > 20 || typeof node !== "object") return "";
  if (typeof node.wwwURL === "string" && node.wwwURL.includes("facebook.com")) return node.wwwURL;
  if (typeof node.url === "string" && /facebook\.com\/.+(posts|permalink|story|videos)/.test(node.url)) return node.url;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") {
      const r = firstUrl(v, depth + 1);
      if (r) return r;
    }
  }
  return "";
}

// 判斷是否為一則貼文（Story）節點
function isStoryNode(node) {
  if (!node || typeof node !== "object") return false;
  return node.__typename === "Story" ||
    (typeof node.post_id === "string" || typeof node.post_id === "number");
}

// 從任意 JSON 遞迴抽出「看起來是貼文」的節點
function harvest(node, depth = 0) {
  if (!capturing || !node || depth > 40) return;
  if (Array.isArray(node)) {
    for (const x of node) harvest(x, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  if (isStoryNode(node)) {
    const id = String(node.post_id ?? node.id ?? "");
    const text = firstMessageText(node);
    // 沒有內文的（例如純分享/廣告框）先略過
    if (id && text && !posts.has(id)) {
      const likes = findCount(node, ["i18n_reaction_count", "reaction_count", "reactioncount"]) ?? 0;
      const comments = findCount(node, ["i18n_comment_count", "total_comment_count", "comment_count"]) ?? 0;
      const shares = findCount(node, ["i18n_share_count", "share_count"]) ?? 0;
      const ct = findCount(node, ["creation_time"]);
      posts.set(id, {
        author: firstActorName(node),
        content: text.replace(/\s+/g, " ").trim(),
        likes: Number(likes) || 0,
        comments: Number(comments) || 0,
        shares: Number(shares) || 0,
        posted_at: ct ? new Date(ct * 1000).toISOString() : "",
        url: firstUrl(node),
      });
    }
  }

  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") harvest(v, depth + 1);
  }
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(file, rows) {
  const cols = ["author", "content", "likes", "comments", "shares", "posted_at", "url", "relevant", "hit", "hit_reason"];
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  fs.writeFileSync(file, "﻿" + lines.join("\n"), "utf8"); // BOM 讓 Excel 中文不亂碼
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

(async () => {
  if (!fs.existsSync(path.join(__dirname, FB_CONFIG.AUTH_FILE))) {
    log("找不到 fb_auth_state.json，請先執行：npm run fb-auth");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, channel: FB_CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: FB_CONFIG.AUTH_FILE,
    viewport: { width: 1280, height: 900 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  // 攔截所有 GraphQL / API JSON 回應
  page.on("response", async (resp) => {
    try {
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("application/json") && !ct.includes("text/javascript")) return;
      const u = resp.url();
      if (!/graphql|\/api\//i.test(u)) return;
      const body = await resp.text();
      // FB 有時一個回應塞多個 JSON（用換行分隔），逐段解析
      for (const chunk of body.split("\n")) {
        const s = chunk.trim();
        if (!s.startsWith("{")) continue;
        try { harvest(JSON.parse(s)); } catch {}
      }
    } catch {}
  });

  capturing = true;
  const target = FB_CONFIG.TARGET_POSTS;

  for (let i = 0; i < FB_CONFIG.KEYWORDS.length; i++) {
    if (posts.size >= target) break;
    const kw = FB_CONFIG.KEYWORDS[i];
    // FB「貼文」搜尋頁（預設排序偏熱門/相關）
    const searchUrl = `${BASE}/search/posts?q=${encodeURIComponent(kw)}`;
    log(`[${i + 1}/${FB_CONFIG.KEYWORDS.length}] 搜尋「${kw}」  (目前已收集 ${posts.size} 篇)`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(3500);

    for (let s = 0; s < FB_CONFIG.SCROLLS_PER_KEYWORD; s++) {
      if (posts.size >= target) break;
      const before = posts.size;
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(rnd(FB_CONFIG.SCROLL_DELAY_MIN, FB_CONFIG.SCROLL_DELAY_MAX));
      if (s >= 3 && posts.size === before) break; // 連續沒新增就換關鍵字
    }
  }

  await browser.close();

  // ── 篩選 ───────────────────────────────────────────────
  const all = [...posts.values()];
  for (const p of all) {
    const relevant = FB_RELEVANCE_KEYWORDS.some((k) => p.content.includes(k));
    p.relevant = relevant;
    p.hit = relevant && p.likes >= FB_CONFIG.LIKES_MIN && p.comments >= FB_CONFIG.COMMENTS_MIN;
    p.hit_reason = p.hit ? `讚${p.likes}/留言${p.comments}` : "";
  }

  const filtered = all
    .filter((p) => p.hit)
    .sort((a, b) => b.comments - a.comments || b.likes - a.likes); // 留言多優先，其次讚數

  fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
  const tag = stamp();
  const rawFile = path.join(__dirname, "output", `fb_raw_${tag}.csv`);
  const hitFile = path.join(__dirname, "output", `fb_filtered_${tag}.csv`);
  writeCsv(rawFile, all);
  writeCsv(hitFile, filtered);
  fs.writeFileSync(
    path.join(__dirname, "output", "fb_filtered_latest.json"),
    JSON.stringify(filtered, null, 2), "utf8"
  );

  log("──────── 完成 ────────");
  log(`合計抓到 ${all.length} 篇，命中 ${filtered.length} 篇  (門檻 讚≥${FB_CONFIG.LIKES_MIN}/留言≥${FB_CONFIG.COMMENTS_MIN})`);
  log("原始檔：", rawFile);
  log("命中檔：", hitFile);
  process.exit(0);
})();
