// 줄 단위 → 문장 단위로 자른다(구분 부호와 뒤 공백 유지)
export function splitSentences(text) {
  const out = [];
  for (const line of text.split('\n')) {
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]; cur += ch;
      const cjkEnd = '。！？'.includes(ch);
      const latinEnd = '.!?'.includes(ch) && (i + 1 === line.length || /\s/.test(line[i + 1]));
      if (cjkEnd || latinEnd) {
        while (i + 1 < line.length && /["'”’)\]」』]/.test(line[i + 1])) cur += line[++i];
        out.push({ text: cur, nl: false }); cur = '';
      }
    }
    out.push({ text: cur, nl: true });
  }
  return out;
}
