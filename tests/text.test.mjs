import assert from "node:assert/strict";
import { splitText, joinParts, LANGS, byId, detectLang } from "../app/text.js";
const t = (n, f) => { try { f(); console.log("ok", n); } catch (e) { console.log("FAIL", n, e.message); process.exitCode = 1; } };
t("7개 언어·NLLB 코드", () => { assert.deepEqual(LANGS.map(l => l.nllb), ["kor_Hang","eng_Latn","jpn_Jpan","zho_Hans","vie_Latn","khk_Cyrl","spa_Latn"]); assert.equal(byId("mn").nllb, "khk_Cyrl"); assert.equal(byId("없음").id, "ko"); });
t("짧은 글은 한 조각", () => assert.deepEqual(splitText("안녕하세요"), [{ text: "안녕하세요", join: "" }]));
t("문장 나누기", () => assert.deepEqual(splitText("Hello. How are you? Fine!").map(p => p.text), ["Hello.", "How are you?", "Fine!"]));
t("줄바꿈 유지", () => { const p = splitText("가\n\n나"); assert.deepEqual(p.map(x => [x.text, x.join]), [["가","\n"],["","\n"],["나",""]]); });
t("긴 문장 자르기(280자 이하)", () => { const s = ("word ".repeat(200)).trim() + "."; const p = splitText(s); assert.ok(p.length >= 3); assert.ok(p.every(x => x.text.length <= 281)); assert.equal(p.map(x => x.text).join(" ").replace(/\s+/g," "), s); });
t("중국어 문장", () => assert.deepEqual(splitText("你好。我很好！").map(p => p.text), ["你好。", "我很好！"]));
t("잇기: 영어는 빈칸, 일본어는 붙임", () => { const p = splitText("가. 나."); assert.equal(joinParts(p, ["A.", "B."], "en"), "A. B."); assert.equal(joinParts(p, ["あ。", "い。"], "ja"), "あ。い。"); });
t("잇기: 중국어 원문 → 영어는 빈칸", () => { const p = splitText("你好。我很好！"); assert.equal(joinParts(p, ["Hi.", "I'm fine!"], "en"), "Hi. I'm fine!"); });
t("일본어 글자 사이 빈칸 지움", () => assert.equal(joinParts(splitText("가"), ["レストランを 紹介してください"], "ja"), "レストランを紹介してください"));
t("자동 감지 7개 언어", () => {
  const cases = { ko: "화장실이 어디예요?", en: "Where is the station?", ja: "駅はどこですか", zh: "这个多少钱", vi: "Bạn có thể giúp tôi không?", mn: "Би солонгос хүн", es: "¿Dónde está el baño?" };
  for (const [k, v] of Object.entries(cases)) assert.equal(detectLang(v), k, v);
  assert.equal(detectLang("123 !!"), null);
});
t("빈 입력", () => assert.deepEqual(splitText(""), []));
