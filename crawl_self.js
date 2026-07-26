// ── 抓「自己」的 Threads 貼文（學語氣用）───────────────────────────
// 用法：node crawl_self.js
// 目的：登入 @eat.map.journal，捲自己的個人頁，攔截 GraphQL JSON，
//       把「本人發的貼文內文」蒐集出來 → output/self_posts.json / .txt
//       之後拿去分析語氣、寫成自動回覆 skill。

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = CONFIG.BASE_URL;
const ME = CONFIG.TARGET_ACCOUNT; // eat.map.journal
const log = (...a) => console.log("[self]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

const posts = new Map(); // code -> post
let capturing = true;

// 第二段（收留言）用：打開單篇貼文時，把別人的回覆暫存起來
const MAX_REPLY_POSTS = Number(process.env.SELF_REPLY_POSTS || 100);
const replyBuf = [];
let collectingReplies = false;

// 從任意 JSON 遞迴抽出「本人發的貼文」節點
function harvest(node, depth = 0) {
  if (!capturing || !node || depth > 45) return;
  if (Array.isArray(node)) { for (const x of node) harvest(x, depth + 1); return; }
  if (typeof node !== "object") return;

  const looksLikePost =
    typeof node.code === "string" &&
    typeof node.like_count === "number" &&
    (node.pk !== undefined || node.id !== undefined);

  if (looksLikePost) {
    const username = node.user?.username ?? "";
    // 收留言階段：別人的貼文節點就是這篇的回覆
    if (collectingReplies && username && username !== ME) {
      const t = (node.caption?.text ?? node.text ?? "").trim();
      if (t) replyBuf.push({ author: "@" + username, text: t });
    }
    // 只留「本人」的貼文（自己的個人頁也會混入被回覆者/引用的貼文）
    if (username === ME && !posts.has(node.code)) {
      const text = node.caption?.text ?? node.text ?? "";
      posts.set(node.code, {
        code: node.code,
        content: (text || "").trim(),
        likes: Number(node.like_count) || 0,
        comments: Number(
          node.text_post_app_info?.direct_reply_count ??
          node.direct_reply_count ?? node.reply_count ?? 0
        ) || 0,
        posted_at: node.taken_at ? new Date(node.taken_at * 1000).toISOString() : "",
        url: `${BASE}/@${username}/post/${node.code}`,
      });
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") harvest(v, depth + 1);
  }
}

async function collectDomReplies(page, currentCode) {
  return page.evaluate(({ me, currentCode }) => {
    const ignored = new Set(["回覆", "翻譯", "查看動態", "更多", "分享", "讚"]);
    const results = [];
    const seenCodes = new Set();
    for (const link of document.querySelectorAll('a[href*="/post/"]')) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/^\/@([^/]+)\/post\/([^/?#]+)/);
      if (!match) continue;
      const [, username, code] = match;
      if (username === me || code === currentCode || seenCodes.has(code)) continue;

      let box = link;
      let lines = [];
      for (let level = 0; level < 10 && box; level++, box = box.parentElement) {
        lines = (box.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
        if (lines.length >= 3 && lines.includes(username)) break;
      }
      const text = lines
        .filter((line) =>
          line !== username &&
          !ignored.has(line) &&
          !/^\d+$/.test(line) &&
          !/^\d{4}[年/-]\d{1,2}/.test(line) &&
          !/^\d{4}-\d{1,2}-\d{1,2}$/.test(line)
        )
        .join(" ")
        .trim();
      if (text && text.length <= 500) {
        seenCodes.add(code);
        results.push({ author: `@${username}`, text });
      }
    }
    return results;
  }, { me: ME, currentCode });
}

(async () => {
  if (!fs.existsSync(path.join(__dirname, CONFIG.AUTH_FILE))) {
    log("找不到 auth_state.json，請先執行：npm run auth"); process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, channel: CONFIG.CHANNEL });
  const context = await browser.newContext({
    storageState: CONFIG.AUTH_FILE,
    viewport: { width: 1280, height: 900 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  page.on("response", async (resp) => {
    try {
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("application/json")) return;
      const u = resp.url();
      if (!/graphql|\/api\/|thread|profile|feed/i.test(u)) return;
      harvest(await resp.json());
    } catch {}
  });

  log(`打開自己的個人頁 @${ME} ...`);
  await page.goto(`${BASE}/@${ME}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);

  const MAX_SCROLL = 40; // 盡量往下捲，抓越多越好
  for (let s = 0; s < MAX_SCROLL; s++) {
    const before = posts.size;
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await page.waitForTimeout(rnd(1800, 3500));
    if (s % 5 === 0) log(`  捲動 ${s + 1}/${MAX_SCROLL}，目前收集 ${posts.size} 篇`);
    // 連續幾輪都沒新增就提早停
    if (s > 6 && posts.size === before) {
      // 再多試兩輪確認到底
      await page.waitForTimeout(2500);
      if (posts.size === before) { log("  沒有更多貼文，提早結束"); break; }
    }
  }

  // ── 第二段：逐篇打開自己的貼文，把底下的留言也收進來當素材 ──────
  // 網友常在留言補「那家在OO路」「還有另一間也好吃」，這些字詞一樣能拿來配對。
  // 和舊素材合併：Threads 偶爾只回傳部分個人頁，不能因此把歷史資料洗掉。
  try {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, "output", "self_posts.json"), "utf8"));
    for (const p of Array.isArray(old) ? old : []) {
      if (p.code && !posts.has(p.code)) posts.set(p.code, p);
    }
  } catch {}
  const all = [...posts.values()].sort((a, b) => (b.posted_at > a.posted_at ? 1 : -1));
  const REPLY_TARGETS = all.slice(0, MAX_REPLY_POSTS);
  log(`開始收留言（前 ${REPLY_TARGETS.length} 篇）...`);

  for (let i = 0; i < REPLY_TARGETS.length; i++) {
    const p = REPLY_TARGETS[i];
    replyBuf.length = 0;
    collectingReplies = true;
    await page.goto(p.url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(rnd(2500, 4000));
    await page.evaluate(() => window.scrollBy(0, 1500)).catch(() => {});
    await page.waitForTimeout(rnd(1500, 2500));
    collectingReplies = false;

    // GraphQL 結構改版時，用頁面上實際顯示的回覆節點補抓。
    const domReplies = await collectDomReplies(page, p.code).catch(() => []);
    replyBuf.push(...domReplies);

    // 去重（自己的回覆在兩條路徑都已排除）
    const seen = new Set();
    p.replies = replyBuf
      .filter((r) => r.text && !seen.has(r.text) && seen.add(r.text))
      .slice(0, 30);
    if ((i + 1) % 10 === 0 || i === REPLY_TARGETS.length - 1) {
      log(`  留言收集 ${i + 1}/${REPLY_TARGETS.length}`);
    }
  }

  await browser.close();
  fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "output", "self_posts.json"),
    JSON.stringify(all, null, 2), "utf8"
  );
  // 純文字版：方便直接讀語氣
  const txt = all.map((p, i) =>
    `── #${i + 1}  (讚${p.likes}/留言${p.comments})  ${p.posted_at}\n${p.content}\n${p.url}`
  ).join("\n\n");
  fs.writeFileSync(path.join(__dirname, "output", "self_posts.txt"), "﻿" + txt, "utf8");

  const replyTotal = all.reduce((n, p) => n + (p.replies?.length || 0), 0);
  log(`──────── 完成：共 ${all.length} 篇本人貼文、${replyTotal} 則留言 ────────`);
  log("JSON：output/self_posts.json");
  log("純文字：output/self_posts.txt");
  process.exit(0);
})();
