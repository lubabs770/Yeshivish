// src/chunk.ts
// Split text into chunks no longer than maxLen, preferring to break on
// newlines, then spaces, falling back to a hard character split.
export function chunkText(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = rest.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen; // no break point: hard split

    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, ""); // drop the boundary char
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
