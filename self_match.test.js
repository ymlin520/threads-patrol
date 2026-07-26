import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCommentMaterials,
  buildCommentReply,
  matchCommentMaterial,
} from "./self_match.js";

const posts = [{
  content: "有沒有人吃過空也？求推薦",
  url: "https://www.threads.com/@eat.map.journal/post/example",
  replies: [
    { author: "@guest", text: "我吃過，草莓蛋糕很清爽，會再回訪" },
    { author: "@guest2", text: "不知道耶，蹲一個" },
  ],
}];

test("把有效網友留言建成素材，排除沒有答案的卡位留言", () => {
  const materials = buildCommentMaterials(posts);
  assert.equal(materials.length, 1);
  assert.equal(materials[0].text, "我吃過，草莓蛋糕很清爽，會再回訪");
  assert.ok(materials[0].tokens.includes("空也"));
});

test("相同店名的徵求文會產生可自動回覆內容", () => {
  const materials = buildCommentMaterials(posts);
  const result = buildCommentReply("請問有人吃過空也嗎？", true, materials);
  assert.equal(result.auto_reply_eligible, true);
  assert.match(result.reply, /草莓蛋糕很清爽/);
  assert.match(result.reply, /threads\.com/);
});

test("非徵求文不自動回，只有泛主題也不算高信心", () => {
  const materials = buildCommentMaterials(posts);
  assert.equal(buildCommentReply("空也的照片真美", false, materials), null);
  assert.equal(matchCommentMaterial("最近想找蛋糕", materials), null);
});
