// ── 發布前通知：把最新海巡命中結果摘要傳到 Telegram ─────────────────
// 用法：node notify_telegram.js
//
// 憑證來源（擇一）：
//   1. 環境變數 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID（GitHub Actions 用 Secrets 帶入）
//   2. telegram.local.json：{ "bot_token": "...", "chat_id": "..." }（本機用，勿進版控）
//
// chat_id 沒設時會自動呼叫 getUpdates 偵測（你要先傳過任一訊息給 bot），
// 偵測到會回寫 telegram.local.json，下次不用再抓。

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CFG = path.join(__dirname, "telegram.local.json");
const log = (...a) => console.log("[notify]", ...a);

function loadLocalCfg() {
  try { return JSON.parse(fs.readFileSync(LOCAL_CFG, "utf8")); } catch { return {}; }
}

const localCfg = loadLocalCfg();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || localCfg.bot_token;
let chatId = process.env.TELEGRAM_CHAT_ID || localCfg.chat_id;

if (!TOKEN) {
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

function loadHits() {
  const f = path.join(__dirname, "output", "filtered_latest.json");
  if (!fs.existsSync(f)) {
    log("找不到 output/filtered_latest.json，請先執行 node patrol.js");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function buildMessage(hits) {
  const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  const byGroup = {};
  for (const h of hits) (byGroup[h.group] ??= []).push(h);

  const lines = [`🐟 海巡完成 ${now}`, `命中 ${hits.length} 篇（` +
    Object.entries(byGroup).map(([g, a]) => `${g} ${a.length}`).join("／") + "）", ""];

  const TOP = 8;
  hits.slice(0, TOP).forEach((h, i) => {
    const excerpt = (h.content || "").slice(0, 50);
    lines.push(`${i + 1}. [${h.group}] ${h.author}  讚${h.likes}/留言${h.comments}`);
    lines.push(`   ${excerpt}${(h.content || "").length > 50 ? "…" : ""}`);
    lines.push(`   ${h.url}`);
  });
  if (hits.length > TOP) lines.push(`…另有 ${hits.length - TOP} 篇，詳見 output/filtered_latest.json`);

  lines.push("", "⚠️ 尚未回覆任何貼文。確認沒問題後執行：node reply.js --live");
  return lines.join("\n");
}

(async () => {
  if (!chatId) chatId = await detectChatId();

  const hits = loadHits();
  let text = buildMessage(hits);
  if (text.length > 3900) text = text.slice(0, 3900) + "\n…（過長截斷）";

  await tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  log(`✅ 已通知 Telegram（chat_id=${chatId}，命中 ${hits.length} 篇）`);
})().catch((e) => { log("❌", e.message); process.exit(1); });
