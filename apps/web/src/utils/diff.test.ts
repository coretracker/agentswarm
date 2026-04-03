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

test("parseRenderableDiff preserves zero revisions for binary image adds and deletes", () => {
  const added = [
    "diff --git a/public/new.png b/public/new.png",
    "new file mode 100644",
    "index 0000000..1111111",
    "Binary files /dev/null and b/public/new.png differ"
  ].join("\n");
  const deleted = [
    "diff --git a/public/deleted.png b/public/deleted.png",
    "deleted file mode 100644",
    "index 1111111..0000000",
    "Binary files a/public/deleted.png and /dev/null differ"
  ].join("\n");

  const [addedFile] = parseRenderableDiff(added);
  const [deletedFile] = parseRenderableDiff(deleted);

  assert.equal(addedFile?.oldRevision, "0000000");
  assert.equal(addedFile?.newRevision, "1111111");
  assert.equal(deletedFile?.oldRevision, "1111111");
  assert.equal(deletedFile?.newRevision, "0000000");
});

test("isImageDiffPath matches common image extensions", () => {
  assert.equal(isImageDiffPath("assets/preview.webp"), true);
  assert.equal(isImageDiffPath("src/app.tsx"), false);
});
