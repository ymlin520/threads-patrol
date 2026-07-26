// ── 發布前通知：把最新海巡命中結果 + 建議回覆稿傳到 Telegram ─────────
// 用法：node notify_telegram.js
//
// 憑證來源（擇一）：
//   1. 環境變數 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID（GitHub Actions 用 Secrets 帶入）
//   2. telegram.local.json：{ "bot_token": "...", "chat_id": "..." }（本機用，勿進版控）
//
// 額外產出：output/replies_draft.json —— 每篇配好的回覆稿。
// 下載 artifact 後把它放到專案根目錄（蓋掉舊的 replies_draft.json），
// reply.js 就會照這份稿子回覆，跟 Telegram 預覽的內容一致。

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CFG = path.join(__dirname, "telegram.local.json");
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

// 每篇配一句建議回覆，並存成 reply.js 可直接用的回覆稿
function buildDrafts(hits) {
  const drafts = hits.map((h) => ({
    group: h.group,
    author: h.author,
    likes: h.likes,
    comments: h.comments,
    url: h.url,
    content: h.content,
    reply: pick(REPLY_TEMPLATES[h.group] || REPLY_TEMPLATES._default),
  }));
  fs.writeFileSync(
    path.join(__dirname, "output", "replies_draft.json"),
    JSON.stringify(drafts, null, 2), "utf8"
  );
  return drafts;
}

function buildMessages(drafts) {
  const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  const byGroup = {};
  for (const d of drafts) (byGroup[d.group] ??= []).push(d);

  const header = [`🐟 海巡完成 ${now}`, `命中 ${drafts.length} 篇（` +
    Object.entries(byGroup).map(([g, a]) => `${g} ${a.length}`).join("／") + "）"];

  const blocks = drafts.map((d, i) => {
    const excerpt = (d.content || "").slice(0, 40);
    return [
      `${i + 1}. [${d.group}] ${d.author}  讚${d.likes}/留言${d.comments}`,
      `📝 ${excerpt}${(d.content || "").length > 40 ? "…" : ""}`,
      `💬 建議回覆：${d.reply}`,
      `🔗 ${d.url}`,
    ].join("\n");
  });

  const footer = "⚠️ 尚未回覆任何貼文。回覆稿已存 replies_draft.json（在 artifact 裡）。\n" +
    "下載後放到專案根目錄，執行 node reply.js 預覽、node reply.js --live 送出。";

  // Telegram 單則上限 4096 字，超過就拆多則
  const messages = [];
  let cur = header.join("\n");
  for (const b of blocks) {
    if ((cur + "\n\n" + b).length > 3800) { messages.push(cur); cur = b; }
    else cur += "\n\n" + b;
  }
  if ((cur + "\n\n" + footer).length > 3800) { messages.push(cur); cur = footer; }
  else cur += "\n\n" + footer;
  messages.push(cur);
  return messages;
}

(async () => {
  if (!chatId) chatId = await detectChatId();

  const hits = loadHits();
  const drafts = buildDrafts(hits);
  const messages = buildMessages(drafts);

  for (const text of messages) {
    await tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  }
  log(`✅ 已通知 Telegram（chat_id=${chatId}，命中 ${hits.length} 篇，共 ${messages.length} 則訊息）`);
})().catch((e) => { log("❌", e.message); process.exit(1); });
