// ── Instagram 海巡機器人設定檔（所有可調參數集中在這）─────────────────

export const IG_CONFIG = {
  TARGET_ACCOUNT: "eat.map.journal",          // 必須登入的小帳號
  BASE_URL: "https://www.instagram.com",
  AUTH_FILE: "ig_auth_state.json",
  CHANNEL: "chrome",   // 用系統的 Chrome；可改 "msedge"

  // 搜尋關鍵字（依主題分組，每組獨立抓滿 PER_GROUP_TARGET 篇才換下一組）
  // IG 反爬較嚴，關鍵字比 Threads 版精簡，避免單次跑太久被限流
  KEYWORD_GROUPS: {
    "美食": [
      "美食推薦", "隱藏版美食", "巷弄美食", "咖啡廳", "甜點", "餐廳推薦",
    ],
    "旅遊": [
      "旅遊", "打卡景點", "一日遊", "秘境", "住宿推薦", "週末去哪",
    ],
  },

  // 抓取量（IG 版保守一點）
  PER_GROUP_TARGET: 30,       // 每個主題各抓幾篇
  SCROLLS_PER_KEYWORD: 6,     // 每個關鍵字最多捲動幾次
  SCROLL_DELAY_MIN: 2200,     // 每次捲動後最短等待（ms）
  SCROLL_DELAY_MAX: 4500,     // 每次捲動後最長等待（ms）

  // ── 篩選門檻（每個主題各自設定）────────────────────
  // 命中 = 內文相關 AND likes >= LIKES_MIN AND comments >= COMMENTS_MIN
  GROUP_FILTERS: {
    "美食": { LIKES_MIN: 30, COMMENTS_MIN: 3 },
    "旅遊": { LIKES_MIN: 10, COMMENTS_MIN: 3 },
  },
  DEFAULT_FILTER: { LIKES_MIN: 30, COMMENTS_MIN: 3 },
};

// 內文相關性判定用的關鍵字（與 Threads 版共用同一份清單）
export { RELEVANCE_KEYWORDS } from "./config.js";
