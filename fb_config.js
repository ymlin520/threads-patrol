// ── Facebook 美食熱門貼文爬蟲設定檔 ─────────────────────────────
// 沿用 Threads 海巡的同一套策略（攔截 GraphQL JSON → 遞迴抽貼文），
// 只是換成 Facebook。FB 的 JSON 結構更亂，門檻與關鍵字可依實測調整。

// 環境變數覆蓋用：值不合法（非正整數）就退回預設，避免打錯字靜默變成 0
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

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
  // 測試時想小量跑，用環境變數覆蓋，不必改這個檔：
  //   FB_TARGET=5 FB_KEYWORDS=2 FB_SCROLLS=3 node fb_patrol.js
  TARGET_POSTS: num(process.env.FB_TARGET, 80),        // 總共想抓幾篇（達標就提早結束）
  SCROLLS_PER_KEYWORD: num(process.env.FB_SCROLLS, 10),// 每個關鍵字最多捲動幾次
  KEYWORD_LIMIT: num(process.env.FB_KEYWORDS, 0),      // >0 時只用前 N 個關鍵字（測試用）
  SCROLL_DELAY_MIN: 2200,    // 每次捲動後最短等待（ms，FB 較敏感，放慢一點）
  SCROLL_DELAY_MAX: 4500,

  // ── 篩選門檻 ──────────────────────────────────────
  // 注意：FB 搜尋結果的 GraphQL 對「部分貼文」不給真實留言數，會回 0
  //（實測某篇實際有 14 則留言，payload 裡 comment_rendering_instance
  //  .comments.total_count 仍是 0，且整包 payload 找不到別的欄位帶正確值）。
  // 所以 comments===0 要當「未知」而不是「真的沒人留言」，否則會把好目標全篩掉。
  //
  // 命中規則：
  //   內文相關 AND (
  //     留言數 > 0  → 套用 LIKES_MIN + COMMENTS_MIN
  //     留言數 = 0  → 留言數不可信，改用較高的 LIKES_MIN_UNKNOWN_COMMENTS 把關
  //   )
  LIKES_MIN: 0,
  COMMENTS_MIN: 3,
  LIKES_MIN_UNKNOWN_COMMENTS: num(process.env.FB_LIKES_UNKNOWN, 30),
};

// 內文相關性判定（含任一即算「美食相關」）
export const FB_RELEVANCE_KEYWORDS = [
  "美食", "好吃", "必吃", "推薦", "餐廳", "咖啡", "甜點", "下午茶",
  "火鍋", "燒肉", "拉麵", "小吃", "宵夜", "打卡", "美味", "隱藏版",
  "料理", "菜單", "口味", "巷弄", "平價", "排隊", "限定", "手搖", "早午餐",
];
