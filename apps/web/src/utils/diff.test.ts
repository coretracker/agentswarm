import assert from "node:assert/strict";
import test from "node:test";
import { isImageDiffPath, parseRenderableDiff } from "./diff";

test("parseRenderableDiff keeps binary image files without hunks", () => {
  const diff = [
    "diff --git a/public/hero.png b/public/hero.png",
    "index 1111111..2222222 100644",
    "Binary files a/public/hero.png and b/public/hero.png differ"
  ].join("\n");

  const files = parseRenderableDiff(diff);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.newPath, "public/hero.png");
  assert.equal(files[0]?.type, "modify");
  assert.equal(files[0]?.hunks.length, 0);
});

test("isImageDiffPath matches common image extensions", () => {
  assert.equal(isImageDiffPath("assets/preview.webp"), true);
  assert.equal(isImageDiffPath("src/app.tsx"), false);
});
