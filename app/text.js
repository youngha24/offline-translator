// 순수 함수(시험 대상) — 언어 목록과 긴 글 나누기.
export const LANGS = [
  { id: "ko", name: "한국어", nllb: "kor_Hang", speech: "ko-KR" },
  { id: "en", name: "영어 English", nllb: "eng_Latn", speech: "en-US" },
  { id: "ja", name: "일본어 日本語", nllb: "jpn_Jpan", speech: "ja-JP" },
  { id: "zh", name: "중국어 中文", nllb: "zho_Hans", speech: "zh-CN" },
  { id: "vi", name: "베트남어 Tiếng Việt", nllb: "vie_Latn", speech: "vi-VN" },
  { id: "mn", name: "몽골어 Монгол", nllb: "khk_Cyrl", speech: "mn-MN" },
  { id: "es", name: "스페인어 Español", nllb: "spa_Latn", speech: "es-ES" },
];
export const byId = (id) => LANGS.find((l) => l.id === id) || LANGS[0];

const MAX = 280;   // 한 번에 모델에 넣는 글자 수(NLLB 는 짧은 문장일수록 정확하고 빠르다)

// 줄은 그대로 두고, 긴 줄은 문장 끝(. ! ? 。 ！ ？ …)에서, 그래도 길면 쉼표·빈칸에서 자른다.
// 돌려주는 것: [{text, join}] — join 은 이 조각 뒤에 붙일 구분자("\n" 또는 " " 또는 "").
export function splitText(input) {
  const out = [];
  const lines = String(input || "").replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, li) => {
    const lastJoin = li < lines.length - 1 ? "\n" : "";
    const t = line.trim();
    if (!t) { if (lastJoin) out.push({ text: "", join: lastJoin }); return; }
    const sentences = t.match(/[^.!?。！？…]+[.!?。！？…]+["'”’」』)]*\s*|[^.!?。！？…]+$/g) || [t];
    const pieces = [];
    for (const s of sentences) {
      let rest = s.trim();
      while (rest.length > MAX) {
        let cut = Math.max(rest.lastIndexOf(",", MAX), rest.lastIndexOf("，", MAX), rest.lastIndexOf("、", MAX), rest.lastIndexOf(" ", MAX));
        if (cut < MAX / 3) cut = MAX;
        pieces.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
      }
      if (rest) pieces.push(rest);
    }
    const spaced = !/^[぀-ヿ㐀-鿿]/.test(t);   // 일본어·중국어는 문장 사이에 빈칸을 넣지 않는다
    pieces.forEach((p, i) => out.push({ text: p, join: i < pieces.length - 1 ? (spaced ? " " : "") : lastJoin }));
  });
  return out;
}

export function joinParts(parts, translated, target) {
  const cjk = target === "ja" || target === "zh";
  return parts.map((p, i) => (translated[i] || "") + (p.join === " " && cjk ? "" : p.join === "" && !cjk && i < parts.length - 1 ? " " : p.join)).join("").trim();
}

export function fmtBytes(n) {
  if (!n) return "0MB";
  return n >= 1e9 ? (n / 1e9).toFixed(2) + "GB" : Math.round(n / 1e6) + "MB";
}
