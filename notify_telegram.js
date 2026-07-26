// ── 發布前通知：Threads / IG / FB 海巡結果 + 建議回覆稿傳到 Telegram ──
// 用法：node notify_telegram.js
//
// 憑證來源（擇一）：
//   1. 環境變數 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID（GitHub Actions 用 Secrets 帶入）
//   2. telegram.local.json：{ "bot_token": "...", "chat_id": "..." }（本機用，勿進版控）
//
// 額外產出（存在 output/，會進 artifact）：
//   replies_draft.json     Threads 回覆稿 → 放到專案根目錄後 node reply.js 照稿回
//   ig_replies_draft.json  IG 回覆稿     → 放到專案根目錄後 node ig_reply.js 照稿回

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CFG = path.join(__dirname, "telegram.local.json");
const OUT = (f) => path.join(__dirname, "output", f);
const log = (...a) => console.log("[notify]", ...a);

// ✏️ 回覆範本（與 reply.js 同語氣，依主題隨機挑一句）
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
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 三個平台的結果檔與回覆稿設定
const PLATFORMS = [
  { label: "🧵 Threads",   file: "filtered_latest.json",    draft: "replies_draft.json",    replyCmd: "node reply.js" },
  { label: "📸 Instagram", file: "ig_filtered_latest.json", draft: "ig_replies_draft.json", replyCmd: "node ig_reply.js" },
  { label: "📘 Facebook",  file: "fb_filtered_latest.json", draft: null,                    replyCmd: null },
];

function loadLocalCfg() {
  try { return JSON.parse(fs.readFileSync(LOCAL_CFG, "utf8")); } catch { return {}; }
}

// --dry-run：只把要送的訊息印在畫面上，不真的發到 Telegram（也不需要 token）
const DRY_RUN = process.argv.includes("--dry-run");

const localCfg = loadLocalCfg();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || localCfg.bot_token;
let chatId = process.env.TELEGRAM_CHAT_ID || localCfg.chat_id;

if (!TOKEN && !DRY_RUN) {
  log("❌ 沒有 bot token：請設環境變數 TELEGRAM_BOT_TOKEN，或建立 telegram.local.json");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method} 失敗：${data.description}`);
  return data.result;
}

async function detectChatId() {
  const updates = await tg("getUpdates");
  const msgs = updates.filter((u) => u.message?.chat?.id);
  if (!msgs.length) {
    throw new Error("getUpdates 沒有任何訊息——請先在 Telegram 傳一句話給你的 bot，再重跑一次。");
  }
  const id = String(msgs[msgs.length - 1].message.chat.id);
  fs.writeFileSync(LOCAL_CFG, JSON.stringify({ ...localCfg, chat_id: id }, null, 2), "utf8");
  log(`✅ 偵測到 chat_id=${id}，已存入 telegram.local.json`);
  return id;
}

function loadHits(file) {
  try { return JSON.parse(fs.readFileSync(OUT(file), "utf8")); } catch { return null; }
}

// 每篇配一句建議回覆；有 draft 檔名的平台會存回覆稿供 reply 腳本使用
function buildDrafts(hits, draftFile) {
  const drafts = hits.map((h) => ({
    group: h.group || "美食",
    author: h.author || "",
    likes: h.likes ?? 0,
    comments: h.comments ?? 0,
    url: h.url || "",
    content: h.content || "",
    reply: pick(REPLY_TEMPLATES[h.group] || REPLY_TEMPLATES._default),
  }));
  if (draftFile) {
    fs.writeFileSync(OUT(draftFile), JSON.stringify(drafts, null, 2), "utf8");
  }
  return drafts;
}

// 每個主題各推幾篇（不是整個平台前 N 篇——否則排序會讓單一主題吃光名額）
const TOP_PER_GROUP = 10;

function platformSection(p, drafts) {
  if (drafts === null) {
    return `${p.label}：－（沒有結果檔：該平台憑證未設定，或今天執行失敗）`;
  }
  if (!drafts.length) {
    return `${p.label}：抓到了但 0 篇命中門檻`;
  }

  // 依主題分組，各組內按讚數由高到低
  const byGroup = new Map();
  for (const d of drafts) {
    const g = d.group || "其他";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(d);
  }
  for (const arr of byGroup.values()) arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));

  const lines = [`${p.label}：命中 ${drafts.length} 篇`];
  for (const [g, arr] of byGroup) {
    lines.push(`── ${g}（命中 ${arr.length} 篇，推 ${Math.min(arr.length, TOP_PER_GROUP)} 篇）──`);
    arr.slice(0, TOP_PER_GROUP).forEach((d, i) => {
      const excerpt = (d.content || "").slice(0, 40);
      lines.push(
        `${i + 1}. ${d.author}  讚${d.likes}/留言${d.comments}`,
        `📝 ${excerpt}${(d.content || "").length > 40 ? "…" : ""}`,
        `💬 建議回覆：${d.reply}`,
        `🔗 ${d.url}`
      );
    });
    if (arr.length > TOP_PER_GROUP) {
      lines.push(`…${g}另有 ${arr.length - TOP_PER_GROUP} 篇，詳見 artifact`);
    }
  }
  return lines.join("\n");
}

const LIMIT = 3800;   // Telegram 單則上限 4096，留點餘裕

// 單一平台區塊本身就可能超過上限（2 主題 × 10 篇），先逐行切成數段
function splitSection(s) {
  if (s.length <= LIMIT) return [s];
  const out = [];
  let cur = "";
  for (const line of s.split("\n")) {
    if (cur && (cur + "\n" + line).length > LIMIT) { out.push(cur); cur = line; }
    else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

// 一個平台一則訊息（Threads / IG / FB 各一則）。
// header 併進第一則、footer 併進最後一則；單一平台若超過字數上限才會再被切開。
function chunkMessages(sections, header, footer) {
  const messages = [];
  sections.forEach((s, i) => {
    let body = s;
    if (i === 0) body = `${header}\n\n${body}`;
    if (i === sections.length - 1) body = `${body}\n\n${footer}`;
    messages.push(...splitSection(body));
  });
  return messages;
}

(async () => {
  if (!chatId && !DRY_RUN) chatId = await detectChatId();

  const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  let total = 0, anyFile = false;
  const sections = [];

  for (const p of PLATFORMS) {
    const hits = loadHits(p.file);
    if (hits === null) { sections.push(platformSection(p, null)); continue; }
    anyFile = true;
    const drafts = buildDrafts(hits, p.draft);
    total += drafts.length;
    sections.push(platformSection(p, drafts));
  }

  const header = `🐟 海巡完成 ${now}\n三平台合計命中 ${total} 篇`;
  const footer =
    "⚠️ 尚未回覆任何貼文。回覆稿已存 artifact（replies_draft.json / ig_replies_draft.json）。\n" +
    "下載後放到專案根目錄，執行 node reply.js（Threads）/ node ig_reply.js（IG）預覽，加 --live 送出。";

  const messages = chunkMessages(sections, header, footer);
  if (DRY_RUN) {
    messages.forEach((text, i) => {
      console.log(`\n──────── 第 ${i + 1}/${messages.length} 則（${text.length} 字）────────`);
      console.log(text);
    });
    log(`🔍 dry-run：共 ${messages.length} 則、合計命中 ${total} 篇，未送出`);
  } else {
    for (const text of messages) {
      await tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
    }
    log(`✅ 已通知 Telegram（合計命中 ${total} 篇）`);
  }

  if (!anyFile) {
    log("❌ 三個平台都沒有結果檔——請檢查憑證 secrets 與海巡步驟的 log");
    process.exit(1);
  }
})().catch((e) => { log("❌", e.message); process.exit(1); });
