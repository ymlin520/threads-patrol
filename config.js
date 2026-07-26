// ── Threads 海巡機器人設定檔（所有可調參數集中在這）─────────────────

export const CONFIG = {
  TARGET_ACCOUNT: "eat.map.journal",          // 必須登入的小帳號
  BASE_URL: "https://www.threads.com",
  AUTH_FILE: "auth_state.json",
  CHANNEL: "chrome",   // 用系統的 Chrome（避開 Playwright 內建 Chromium 缺執行庫問題）；可改 "msedge"

  // 搜尋關鍵字（依主題分組，每組獨立抓滿 PER_GROUP_TARGET 篇才換下一組）
  KEYWORD_GROUPS: {
    "美食": [
      "美食推薦", "必吃", "隱藏版美食", "巷弄美食", "平價美食",
      "咖啡廳", "下午茶", "甜點", "火鍋", "燒肉", "拉麵", "打卡美食", "餐廳推薦",
    ],
    "旅遊": [
      "旅遊", "景點", "打卡景點", "一日遊", "國內旅遊",
      "自由行", "露營", "溫泉", "秘境", "住宿推薦", "親子旅遊", "週末去哪",
    ],
  },

  // 抓取量
  PER_GROUP_TARGET: 50,       // 每個主題各抓幾篇（美食 50 + 旅遊 50）
  SCROLLS_PER_KEYWORD: 8,     // 每個關鍵字最多捲動幾次
  SCROLL_DELAY_MIN: 1800,     // 每次捲動後最短等待（ms）
  SCROLL_DELAY_MAX: 3800,     // 每次捲動後最長等待（ms）

  // ── 篩選門檻（每個主題各自設定）────────────────────
  // 命中 = 內文相關 AND likes >= LIKES_MIN AND comments >= COMMENTS_MIN
  GROUP_FILTERS: {
    "美食": { LIKES_MIN: 30, COMMENTS_MIN: 3 },
    "旅遊": { LIKES_MIN: 10, COMMENTS_MIN: 3 },
  },
  DEFAULT_FILTER: { LIKES_MIN: 30, COMMENTS_MIN: 3 },  // 沒對應主題時的預設
};

// 內文相關性判定用的關鍵字（含任一即算相關）
export const RELEVANCE_KEYWORDS = [
  "美食", "好吃", "必吃", "推薦", "餐廳", "咖啡", "甜點", "下午茶",
  "火鍋", "燒肉", "拉麵", "小吃", "宵夜", "打卡", "美味", "隱藏版",
  "旅遊", "旅行", "景點", "一日遊", "自由行", "出國", "露營", "溫泉",
  "秘境", "住宿", "飯店", "民宿", "行程", "親子", "週末", "玩",
];
