import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunk.js";

describe("chunkText", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("returns an empty-string chunk for empty input", () => {
    expect(chunkText("", 100)).toEqual([""]);
  });

  it("splits on newline boundaries when possible", () => {
    const out = chunkText("aaa\nbbb\nccc", 7);
    expect(out).toEqual(["aaa\nbbb", "ccc"]);
  });

  it("hard-splits a single run longer than the limit", () => {
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("never emits a chunk longer than maxLen", () => {
    const out = chunkText("word ".repeat(500), 900);
    expect(out.every((c) => c.length <= 900)).toBe(true);
  });
});
