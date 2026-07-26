// ── 找「在徵蛋糕推薦」的 Threads 貼文（回覆推薦用）────────────────
// 用法：node find_cake_seekers.js   （需先 npm run auth）
// 目的：用登入狀態搜尋一批「找蛋糕/求蛋糕推薦」關鍵字，攔 GraphQL JSON
//       抽出貼文，再挑出「像是在發問求推薦」的貼文 → output/cake_seekers.json
//       之後拿這些當回覆目標，推薦蛋糕店。

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = CONFIG.BASE_URL;
const log = (...a) => console.log("[cake]", ...a);
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

// 搜尋關鍵字：偏向「發問／求推薦」的語意
const KEYWORDS = [
  "蛋糕推薦", "找蛋糕", "私藏蛋糕", "隱藏版蛋糕", "生日蛋糕推薦",
  "蛋糕店推薦", "求推薦蛋糕", "有沒有推薦的蛋糕", "好吃的蛋糕",
  "彌月蛋糕推薦", "戚風蛋糕推薦", "巴斯克推薦",
];

// 判斷「這是在發問求推薦」而不是店家自推的線索
const ASK_CUES = ["推薦", "有沒有", "求", "找", "私藏", "哪裡", "哪家", "哪間", "名單", "幫我", "想吃", "?", "？"];
const CAKE_CUES = ["蛋糕", "甜點", "巴斯克", "戚風", "千層", "生乳酪", "生乳捲"];

const TARGET = 60;             // 想收集幾篇
const SCROLLS_PER_KEYWORD = 8;

const posts = new Map();
let capturing = false;
let currentKw = "";

function harvest(node, depth = 0) {
  if (!capturing || !node || depth > 40) return;
  if (Array.isArray(node)) { for (const x of node) harvest(x, depth + 1); return; }
  if (typeof node !== "object") return;

  const looksLikePost =
    typeof node.code === "string" &&
    typeof node.like_count === "number" &&
    (node.pk !== undefined || node.id !== undefined);

  if (looksLikePost && !posts.has(node.code)) {
    const username = node.user?.username ?? "";
    const text = (node.caption?.text ?? node.text ?? "").replace(/\s+/g, " ").trim();
    const likes = Number(node.like_count) || 0;
    const comments = Number(
      node.text_post_app_info?.direct_reply_count ??
      node.direct_reply_count ?? node.reply_count ?? 0
    ) || 0;
    const takenAt = node.taken_at ?? null;
    posts.set(node.code, {
      matched_keyword: currentKw,
      author: username ? "@" + username : "",
      content: text,
      likes, comments,
      posted_at: takenAt ? new Date(takenAt * 1000).toISOString() : "",
      url: username ? `${BASE}/@${username}/post/${node.code}` : `${BASE}/t/${node.code}`,
    });
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") harvest(v, depth + 1);
  }
}

async function tryClickRecentTab(page) {
  for (const n of ["最新", "Recent", "最近"]) {
    try {
      const tab = page.getByRole("tab", { name: n });
      if (await tab.count()) { await tab.first().click({ timeout: 2500 }); return true; }
    } catch {}
  }
  return false;
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
      if (!/graphql|\/api\/|thread|search|feed/i.test(u)) return;
      harvest(await resp.json());
    } catch {}
  });

  capturing = true;
  for (let i = 0; i < KEYWORDS.length; i++) {
    if (posts.size >= TARGET) break;
    currentKw = KEYWORDS[i];
    log(`[${i + 1}/${KEYWORDS.length}] 搜尋「${currentKw}」 (已 ${posts.size} 篇)`);
    await page.goto(`${BASE}/search?q=${encodeURIComponent(currentKw)}&serp_type=default`,
      { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2800);
    await tryClickRecentTab(page);
    await page.waitForTimeout(1500);
    for (let s = 0; s < SCROLLS_PER_KEYWORD; s++) {
      if (posts.size >= TARGET) break;
      const before = posts.size;
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await page.waitForTimeout(rnd(1800, 3600));
      if (s >= 3 && posts.size === before) break;
    }
  }
  await browser.close();

  // 標記：像在發問求蛋糕推薦的貼文
  const all = [...posts.values()].map((p) => {
    const askish = ASK_CUES.some((c) => p.content.includes(c));
    const cakeish = CAKE_CUES.some((c) => p.content.includes(c));
    // 排除店家自推的明顯字眼
    const selfPromo = /(自推|自薦|自己|我們是|歡迎來|line id|訂位|預購|開賣|下單|私訊|dm)/i.test(p.content);
    return { ...p, is_seeker: askish && cakeish && !selfPromo };
  });
  const seekers = all
    .filter((p) => p.is_seeker)
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));

  fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "output", "cake_seekers.json"),
    JSON.stringify(seekers, null, 2), "utf8");
  fs.writeFileSync(path.join(__dirname, "output", "cake_all.json"),
    JSON.stringify(all, null, 2), "utf8");

  log(`──────── 完成：共抓 ${all.length} 篇，判定為「在徵蛋糕」的有 ${seekers.length} 篇 ────────`);
  seekers.slice(0, 15).forEach((p, i) =>
    log(`#${i + 1} ${p.author} 讚${p.likes}/留言${p.comments}  ${p.content.slice(0, 40)}…`));
  log("輸出：output/cake_seekers.json");
  process.exit(0);
})();
