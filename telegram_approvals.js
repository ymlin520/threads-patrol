// Telegram 的 Threads / Instagram / Facebook 留言核准監聽器。
// GitHub Actions 用法：
//   xvfb-run --auto-servernum node telegram_approvals.js --wait 1800

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CFG = path.join(__dirname, "telegram.local.json");
const waitArg = process.argv.indexOf("--wait");
const WAIT_SECONDS = waitArg > -1
  ? Math.max(1, Number(process.argv[waitArg + 1]) || 1800)
  : 1800;
const RUN_ID = String(process.env.GITHUB_RUN_ID || "");
const log = (...args) => console.log("[tg-approve]", ...args);

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

const localCfg = loadJson(LOCAL_CFG, {});
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || localCfg.bot_token;
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || localCfg.chat_id || "");
const platforms = {
  th: {
    name: "Threads",
    drafts: loadJson(path.join(__dirname, "output", "replies_draft.json"), []),
    command: (draft) => [
      "reply.js", "--live", "--force-hours", "--url", draft.url, "--text", draft.reply,
    ],
  },
  ig: {
    name: "Instagram",
    drafts: loadJson(path.join(__dirname, "output", "ig_replies_draft.json"), []),
    command: (draft) => [
      "ig_reply.js", "--live", "--force-hours", "--url", draft.url, "--text", draft.reply,
    ],
  },
  fb: {
    name: "Facebook",
    drafts: loadJson(path.join(__dirname, "output", "fb_replies_draft.json"), []),
    command: (draft) => ["fb_comment.js", "post", draft.url, draft.reply],
  },
};
const totalDrafts = Object.values(platforms).reduce((sum, p) => sum + p.drafts.length, 0);

if (!TOKEN || !CHAT_ID) {
  log("缺少 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID");
  process.exit(1);
}
if (!RUN_ID) {
  log("缺少 GITHUB_RUN_ID；核准按鈕只允許在 GitHub Actions 中使用");
  process.exit(1);
}
if (!totalDrafts) {
  log("沒有社群回覆草稿，結束監聽");
  process.exit(0);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const processed = new Set();
let offset = 0;

async function tg(method, payload = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method} 失敗：${data.description}`);
  return data.result;
}

function runComment(platform, draft) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      platform.command(draft),
      { cwd: __dirname, env: process.env, windowsHide: true },
    );
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output, code }));
  });
}

async function answerExpired(callback, text) {
  await tg("answerCallbackQuery", {
    callback_query_id: callback.id,
    text,
    show_alert: true,
  });
}

async function handleCallback(callback) {
  const callbackChatId = String(callback.message?.chat?.id || "");
  if (callbackChatId !== CHAT_ID) {
    await answerExpired(callback, "這個帳號沒有發布權限");
    return;
  }

  const match = /^(th|ig|fb):([^:]+):(\d+)$/.exec(callback.data || "");
  if (!match || match[2] !== RUN_ID) {
    await answerExpired(callback, "這個按鈕已過期，請使用最新一輪通知");
    return;
  }

  const code = match[1];
  const index = Number(match[3]);
  const platform = platforms[code];
  const draft = platform?.drafts[index];
  if (!draft?.url || !draft?.reply) {
    await answerExpired(callback, "找不到對應的回覆稿");
    return;
  }

  const processedKey = `${code}:${index}`;
  if (processed.has(processedKey)) {
    await answerExpired(callback, "這一則已處理，請勿重複送出");
    return;
  }

  processed.add(processedKey);
  await tg("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: "已收到核准，正在發布…",
  });
  await tg("editMessageReplyMarkup", {
    chat_id: CHAT_ID,
    message_id: callback.message.message_id,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});

  log(`發布 ${platform.name} #${index + 1}: ${draft.url}`);
  const result = await runComment(platform, draft);
  const tail = result.output.trim().split(/\r?\n/).slice(-4).join("\n").slice(0, 800);
  const resultText = result.ok
    ? `✅ ${platform.name} 留言已送出\n\n${draft.reply}\n\n${draft.url}`
    : result.code === 10
      ? `⏭️ ${platform.name} 已有回覆紀錄，為避免重複而未再送出\n\n${draft.url}`
      : `❌ ${platform.name} 留言失敗（exit ${result.code ?? "?"}）\n${tail}\n\n${draft.url}`;
  await tg("sendMessage", {
    chat_id: CHAT_ID,
    text: resultText,
    disable_web_page_preview: true,
  });
}

(async () => {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  log(`開始監聽社群核准，期限 ${WAIT_SECONDS} 秒，共 ${totalDrafts} 篇`);

  while (Date.now() < deadline) {
    const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    const timeout = Math.min(25, remaining);
    const updates = await tg("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["callback_query"],
    });
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      if (update.callback_query) {
        await handleCallback(update.callback_query).catch((error) => {
          log("處理 callback 失敗：", error.message);
        });
      }
    }
  }

  log("核准監聽時間結束");
})().catch((error) => {
  log("失敗：", error.message);
  process.exit(1);
});
