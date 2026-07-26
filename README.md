# Threads / FB / IG 海巡機器人（@eat.map.journal）

自動巡邏「美食／旅遊」最新貼文 → 依互動熱度篩選 → 用本人語氣客製回覆。
支援三個平台：Threads（主力）、Facebook（`fb_*.js`）、Instagram（`ig_*.js`）。

## 檔案結構

```
threads-patrol/
├─ config.js            # 設定：關鍵字分組、每組篇數、各主題篩選門檻
├─ auth_setup.js        # 一次性：手動登入 @eat.map.journal，存登入狀態
├─ patrol.js            # 主爬蟲：搜尋→切最新→攔截 JSON 抓貼文→篩選→輸出
├─ reply.js             # 自動回覆：預設乾跑不送，--live 才實際發
├─ notify_telegram.js   # 把命中結果＋建議回覆稿推播到 Telegram（不會回覆貼文）
├─ replies_draft.json   # 逐篇客製回覆稿（reply.js 優先讀這份）
├─ clean_output.js      # 清亂碼／特殊符號工具
├─ package.json
├─ output/              # 產出：raw_*.csv / filtered_*.csv / filtered_latest.json
└─ .claude/skills/eat-map-reply/SKILL.md   # 回覆語氣 skill
```

## 安裝（換電腦第一次）

需要 Node.js 18+。在專案資料夾內：

```bash
npm install playwright
```

> 本專案用系統的 Chrome（config.js 的 `CHANNEL: "chrome"`），所以不必另外 `npx playwright install`。
> 若沒有 Chrome，把 `CHANNEL` 改成 `"msedge"` 用 Edge。

## 使用步驟

### 1. 登入（只需做一次，會產生 auth_state.json）
```bash
node auth_setup.js
```
跳出的瀏覽器視窗裡手動登入 @eat.map.journal，登入成功會自動存檔關閉。

### 2. 爬蟲抓貼文
```bash
node patrol.js
```
產出：
- `output/raw_YYYYMMDD_HHMM.csv`  抓到的全部
- `output/filtered_YYYYMMDD_HHMM.csv`  命中篩選的
- `output/filtered_latest.json`  給 reply.js 用

### 3.（可選）清亂碼
```bash
node clean_output.js
```

### 3.5（可選）推播到 Telegram 先過目
```bash
npm run notify        # 等同 node notify_telegram.js
```
把命中的每一篇＋自動配好的建議回覆稿傳到你的 Telegram，**不會回覆任何貼文**。
同時產生 `output/replies_draft.json`。訊息超過 Telegram 4096 字上限會自動拆成多則。

憑證擇一設定：

- 環境變數 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
  （GitHub Actions 走這條，見 `.github/workflows/patrol.yml`）
- 本機用：專案根目錄建 `telegram.local.json`（已列入 `.gitignore`）
  ```json
  { "bot_token": "你的 bot token", "chat_id": "你的 chat id" }
  ```
  只填 `bot_token` 也可以 — 先在 Telegram 對 bot 傳一句話，
  腳本會用 `getUpdates` 自動偵測 `chat_id` 並寫回設定檔。

跑完直接執行 `node reply.js` 就會照這份稿子回覆，不必手動搬檔案。

### 4. 回覆（先乾跑，確認 OK 再送）
```bash
node reply.js          # 乾跑：只印出會回什麼，不送出
node reply.js --live   # 實際送出
```

### 用自己舊文底下的留言回答徵求文

```bash
npm run crawl-self
node notify_telegram.js --dry-run
node reply.js --auto-solicit          # 預覽高信心徵求文，不送出
node reply.js --live --auto-solicit   # 只送出高信心徵求文
```

`crawl_self.js` 會讀自己的舊 Threads 貼文，並逐篇收集網友留言。系統只有在下列條件
全部成立時才會自動回覆：

- 海巡貼文明確是「求推薦／有人吃過嗎」等徵求文。
- 舊文留言確實含有回答，不是「蹲一個／不知道／沒吃過」。
- 新舊內容有相同特殊名稱（例如「空也」），或同時命中地區與主題。
- 結果未踩雷、沒有回覆過，且仍在每日與單次配額內。

GitHub Actions 每日會更新最多 100 篇舊文的留言素材，通知完成後最多自動回答 2 篇；
其餘一般海巡命中仍只產生草稿，不會自動送出。
已回覆過的記錄在 `replied.json`，不會重複回。

## Instagram 版（ig_*.js）

流程與 Threads 版相同，指令換成：

```bash
npm run ig-auth      # 一次性：手動登入 IG，存 ig_auth_state.json
npm run ig-patrol    # 爬 IG 關鍵字搜尋頁 → output/ig_raw_*.csv / ig_filtered_latest.json
node ig_reply.js             # 乾跑：預覽會留什麼，不送出
node ig_reply.js --live --max 1   # 實際留言（--max 限制篇數）
```

- 設定在 `ig_config.js`（關鍵字比 Threads 版精簡，IG 反爬較嚴）。
- 客製回覆稿放 `ig_replies_draft.json`；已回覆記錄在 `ig_replied.json`。
- 留言送出後會驗證頁面上真的出現才算成功；驗證不到不會盲目重發（避免重複留言）。
- 注意：IG 搜尋頁很多貼文 JSON 不帶讚數，單輪抓取量會比 Threads 少；
  相關性關鍵字與 Threads 共用，在 IG 上偏鬆，命中結果建議人工掃一眼再回。

## 可調參數（config.js）

- `KEYWORD_GROUPS`：美食／旅遊各自的搜尋關鍵字
- `PER_GROUP_TARGET`：每個主題抓幾篇（預設 50）
- `GROUP_FILTERS`：各主題篩選門檻
  - 美食：讚 ≥ 30、留言 ≥ 3
  - 旅遊：讚 ≥ 10、留言 ≥ 3

## 回覆內容怎麼改

- 逐篇客製：直接編輯 `replies_draft.json` 的 `reply` 欄位。
- 語氣規則：見 `.claude/skills/eat-map-reply/SKILL.md`。

`reply.js` 找回覆稿的順序（找到第一份可用的就停）：

1. `replies_draft.json`（根目錄）— 手改的客製稿，優先權最高
2. `output/replies_draft.json` — `notify_telegram.js` 自動產的，與 Telegram 預覽一致
3. 兩份都沒有（或內容壞掉）→ 退回 `reply.js` 內建的 `REPLY_TEMPLATES`

執行時會印出「資料來源」，送出前確認一下用的是哪一份。

## 注意

- ⚠️ `auth_state.json`（登入憑證）與 `telegram.local.json`（bot token）
  **不要外流、不要進版控**——已列入 `.gitignore`。本 repo 是 public，推之前務必確認。
- 回覆頻率請節制（reply.js 內建每次上限 8 篇、間隔 25–60 秒）。
- Threads 改版時，搜尋／回覆的 selector 可能需微調。
