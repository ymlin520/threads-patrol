// ── 用自己的 Threads 舊文與文下留言，回答新的徵求文 ───────────────
//
// 素材來源：output/self_posts.json（由 crawl_self.js 產生）
// 「留言」是獨立素材：例如自己的舊文問空也好不好吃，網友在留言報店名或心得，
// 新海巡文也在問空也時，就能直接拿那則留言的資訊回答，而不是只貼回自己的問題。

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { screenPost } from "./post_filters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_POSTS_FILE = path.join(__dirname, "output", "self_posts.json");

const PLACES = [
  "台北", "臺北", "新北", "台中", "臺中", "台南", "臺南", "高雄", "桃園", "新竹",
  "嘉義", "宜蘭", "花蓮", "台東", "臺東", "基隆", "屏東", "雲林", "南投", "苗栗",
  "彰化", "澎湖", "金門", "士林", "信義", "大安", "中山", "松山", "內湖", "萬華",
  "板橋", "中和", "永和", "新莊", "三重", "淡水", "北投", "天母", "東區", "西區",
];

const TOPICS = [
  "生日蛋糕", "蛋糕", "甜點", "可頌", "麵包", "吐司", "咖啡廳", "咖啡", "下午茶",
  "早午餐", "早餐", "素食", "蔬食", "全素", "火鍋", "燒肉", "炭烤", "燒烤", "串燒",
  "居酒屋", "壽司", "生魚片", "日式", "拉麵", "牛肉麵", "麵食", "小吃", "滷肉飯",
  "便當", "披薩", "義大利麵", "麻辣", "港式", "飲茶", "冰", "飲料", "手搖",
  "巴斯克", "達克瓦茲", "可麗露", "泡芙", "布丁", "鬆餅", "抹茶", "開心果", "生乳",
  "民宿", "飯店", "住宿", "溫泉", "露營", "景點", "步道", "海邊", "秘境", "一日遊",
];

const UNSAFE_COMMENT_WORDS = [
  "不知道", "沒吃過", "沒去過", "求推薦", "想知道", "蹲一個", "卡一個",
  "避雷", "雷店", "難吃", "不推薦", "不要去", "詐騙", "私訊", "加賴", "加line",
];

const GENERIC_WORDS = new Set([
  ...PLACES, ...TOPICS, "推薦", "有人", "有沒有", "吃過", "好吃", "請問", "大家",
  "哪間", "這間", "那間", "餐廳", "店家", "分享", "一下", "可以", "真的",
]);

const found = (text, words) => words.filter((word) => text.includes(word));
const normalize = (text) => (text || "").normalize("NFKC").toLowerCase();

function entityTokens(text) {
  const normalized = normalize(text);
  const patterns = [
    /吃過\s*([\p{Script=Han}A-Za-z0-9._-]{2,12}?)(?:嗎|呢|？|\?|求|推薦|$)/gu,
    /(?:想問|請問|有人知道)\s*([\p{Script=Han}A-Za-z0-9._-]{2,12}?)(?:嗎|呢|？|\?|$)/gu,
    /[📍#]\s*([\p{Script=Han}A-Za-z0-9._-]{2,12}?)(?:[，,。！!？?、（(\s]|$)/gu,
  ];
  const entities = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const value = match[1].replace(/^(這間|那間)/, "").trim();
      if (value.length >= 2 && !GENERIC_WORDS.has(value)) entities.push(value);
    }
  }
  return [...new Set(entities)];
}

function cleanComment(text) {
  return (text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function usableComment(text) {
  const clean = cleanComment(text);
  if (clean.length < 4 || clean.length > 100) return false;
  if (UNSAFE_COMMENT_WORDS.some((word) => clean.toLowerCase().includes(word))) return false;
  if (/[?？]\s*$/.test(clean)) return false;
  return true;
}

function shortQuote(text) {
  const clean = cleanComment(text).replace(/[「」『』【】]/g, "");
  return clean.length > 62 ? `${clean.slice(0, 62)}…` : clean;
}

/**
 * 將舊文資料整理成可配對的「留言素材」。
 * 只收網友留言；自己的舊貼文可提供脈絡，但不直接成為自動回答。
 */
export function buildCommentMaterials(posts) {
  const materials = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    const parentText = post.content || "";
    const parentPlaces = found(parentText, PLACES);
    const parentTopics = found(parentText, TOPICS);
    const parentTokens = entityTokens(parentText);

    for (const reply of Array.isArray(post.replies) ? post.replies : []) {
      if (!usableComment(reply.text)) continue;
      const comment = cleanComment(reply.text);
      materials.push({
        type: "comment",
        text: comment,
        author: reply.author || "",
        source_url: post.url || "",
        source_post: parentText,
        places: [...new Set([...parentPlaces, ...found(comment, PLACES)])],
        topics: [...new Set([...parentTopics, ...found(comment, TOPICS)])],
        tokens: [...new Set([...parentTokens, ...entityTokens(comment)])],
        parent_is_ask: screenPost(post).solicit,
      });
    }
  }
  return materials.filter((m) => m.source_url);
}

let cache = null;

export function loadCommentMaterials() {
  if (cache) return cache;
  try {
    const posts = JSON.parse(fs.readFileSync(SELF_POSTS_FILE, "utf8"));
    cache = buildCommentMaterials(posts);
  } catch {
    cache = [];
  }
  return cache;
}

/**
 * 高信心門檻：
 * - 相同特殊詞（例如店名「空也」）即可成立；
 * - 否則至少要同地區＋同主題，不能只因兩篇都有「蛋糕」就亂配。
 */
export function matchCommentMaterial(content, materials = loadCommentMaterials()) {
  const text = normalize(content);
  if (!text) return null;

  let best = null;
  for (const material of materials) {
    const tokenHits = material.tokens.filter((token) => text.includes(token));
    const placeHits = material.places.filter((place) => text.includes(normalize(place)));
    const topicHits = material.topics.filter((topic) => text.includes(normalize(topic)));
    const hasSpecificToken = tokenHits.some((token) => token.length >= 2);
    const hasContextPair = placeHits.length > 0 && topicHits.length > 0;
    if (!hasSpecificToken && !hasContextPair) continue;

    const score = tokenHits.length * 8 + placeHits.length * 3 + topicHits.length * 2;
    if (!best || score > best.score) {
      best = { material, score, tokenHits, placeHits, topicHits };
    }
  }
  return best;
}

/**
 * 只有「徵求文＋高信心留言匹配」才回傳內容，供自動回覆使用。
 */
export function buildCommentReply(content, solicit = false, materials = loadCommentMaterials()) {
  if (!solicit) return null;
  const match = matchCommentMaterial(content, materials);
  if (!match) return null;

  const quote = shortQuote(match.material.text);
  return {
    reply: `我之前也問過類似的，底下有人推薦：${quote}。也給你參考 ${match.material.source_url}`,
    reply_source: "自己舊文下的留言",
    matched_url: match.material.source_url,
    matched_comment: match.material.text,
    matched_author: match.material.author,
    match_score: match.score,
    match_terms: [...match.tokenHits, ...match.placeHits, ...match.topicHits].join("／"),
    auto_reply_eligible: true,
  };
}
