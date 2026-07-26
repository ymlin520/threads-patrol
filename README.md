# Threads 海巡機器人（@eat.map.journal）

自動巡邏 Threads「美食／旅遊」最新貼文 → 依互動熱度篩選 → 用本人語氣客製回覆。

## 檔案結構

```
threads-patrol/
├─ config.js            # 設定：關鍵字分組、每組篇數、各主題篩選門檻
├─ auth_setup.js        # 一次性：手動登入 @eat.map.journal，存登入狀態
├─ patrol.js            # 主爬蟲：搜尋→切最新→攔截 JSON 抓貼文→篩選→輸出
├─ reply.js             # 自動回覆：預設乾跑不送，--live 才實際發
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

### 4. 回覆（先乾跑，確認 OK 再送）
```bash
node reply.js          # 乾跑：只印出會回什麼，不送出
node reply.js --live   # 實際送出
```
已回覆過的記錄在 `replied.json`，不會重複回。

## 可調參數（config.js）

- `KEYWORD_GROUPS`：美食／旅遊各自的搜尋關鍵字
- `PER_GROUP_TARGET`：每個主題抓幾篇（預設 50）
- `GROUP_FILTERS`：各主題篩選門檻
  - 美食：讚 ≥ 30、留言 ≥ 3
  - 旅遊：讚 ≥ 10、留言 ≥ 3

## 回覆內容怎麼改

- 逐篇客製：複製 `replies_draft.example.json` 成 `replies_draft.json`，編輯其中的 `reply` 欄位。
- 語氣規則：見 `.claude/skills/eat-map-reply/SKILL.md`。

## 注意

- ⚠️ `auth_state.json`（登入憑證）**不要外流、不要進版控**——已列入 `.gitignore`。
- ⚠️ `output/`、`replies_draft.json`、`replied.json` 含他人帳號與貼文內容，同樣已排除版控，請勿公開。
- 回覆頻率請節制（reply.js 內建每次上限 8 篇、間隔 25–60 秒）。
- Threads 改版時，搜尋／回覆的 selector 可能需微調。
