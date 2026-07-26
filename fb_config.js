// ── Facebook 美食熱門貼文爬蟲設定檔 ─────────────────────────────
// 沿用 Threads 海巡的同一套策略（攔截 GraphQL JSON → 遞迴抽貼文），
// 只是換成 Facebook。FB 的 JSON 結構更亂，門檻與關鍵字可依實測調整。

export const FB_CONFIG = {
  BASE_URL: "https://www.facebook.com",
  AUTH_FILE: "fb_auth_state.json",
  CHANNEL: "chrome", // 用系統 Chrome；可改 "msedge"

  // 搜尋關鍵字（美食主題）。每個關鍵字會開 FB「貼文」搜尋頁並捲動。
  KEYWORDS: [
    "美食推薦", "必吃", "隱藏版美食", "巷弄美食", "平價美食",
    "咖啡廳", "下午茶", "甜點", "火鍋", "燒肉", "拉麵",
    "打卡美食", "餐廳推薦", "小吃", "宵夜",
  ],

  // 抓取量
  TARGET_POSTS: 80,          // 總共想抓幾篇（達標就提早結束）
  SCROLLS_PER_KEYWORD: 10,   // 每個關鍵字最多捲動幾次
  SCROLL_DELAY_MIN: 2200,    // 每次捲動後最短等待（ms，FB 較敏感，放慢一點）
  SCROLL_DELAY_MAX: 4500,

  // ── 篩選門檻：命中 = 內文相關 AND 讚≥ AND 留言≥ ──────────
  // 優先抓「留言 3 則以上」的貼文（有互動＝比較能回覆的目標）
  LIKES_MIN: 0,
  COMMENTS_MIN: 3,
};

// 內文相關性判定（含任一即算「美食相關」）
export const FB_RELEVANCE_KEYWORDS = [
  "美食", "好吃", "必吃", "推薦", "餐廳", "咖啡", "甜點", "下午茶",
  "火鍋", "燒肉", "拉麵", "小吃", "宵夜", "打卡", "美味", "隱藏版",
  "料理", "菜單", "口味", "巷弄", "平價", "排隊", "限定", "手搖", "早午餐",
];
