import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanTodos } from "../src/tododebt.js";

/**
 * All tests are pure local computation over inline file
 * contents: no filesystem, no network.
 */

const A = [
  "// TODO: wire the cache",
  "const x = 1;",
  "/* FIXME(user): off-by-one */",
  "// a TODO and a FIXME share a line",
  "const TODOS = [];",
  "function method() {}",
  "// HACK — temporary",
].join("\n");
const B = ["# TODO write docs", "print('hello')"].join("\n");

describe("scanTodos", () => {
  it("finds the default markers with 1-based lines and trimmed text", () => {
    const out = scanTodos([{ path: "a.ts", content: A }]);
    assert.deepEqual(
      out.entries.map((e) => [e.line, e.marker]),
      [
        [1, "TODO"],
        [3, "FIXME"],
        [4, "TODO"],
        [7, "HACK"],
      ],
    );
    assert.equal(out.entries[0].text, "// TODO: wire the cache");
    assert.equal(out.counts.total, 4);
  });

  it("does not match markers glued to more letters (TODOS, METHOD)", () => {
    const out = scanTodos([{ path: "a.ts", content: A }]);
    assert.equal(out.entries.some((e) => e.line === 5 || e.line === 6), false);
  });

  it("reports only the first marker on a shared line", () => {
    const out = scanTodos([{ path: "a.ts", content: A }]);
    const line4 = out.entries.filter((e) => e.line === 4);
    assert.equal(line4.length, 1);
    assert.equal(line4[0].marker, "TODO");
  });

  it("counts by marker and by file across several files", () => {
    const out = scanTodos([
      { path: "a.ts", content: A },
      { path: "b.py", content: B },
    ]);
    assert.equal(out.counts.total, 5);
    assert.deepEqual(out.counts.by_marker, { TODO: 3, FIXME: 1, HACK: 1 });
    assert.deepEqual(out.counts.by_file, { "a.ts": 4, "b.py": 1 });
  });

  it("returns an empty inventory for clean files", () => {
    const out = scanTodos([{ path: "c.ts", content: "const y = 2;\n" }]);
    assert.equal(out.counts.total, 0);
    assert.deepEqual(out.entries, []);
    assert.deepEqual(out.counts.by_file, {});
  });

  it("honours a custom marker list", () => {
    const out = scanTodos([{ path: "a.ts", content: A }], ["XXX", "NOTE"]);
    assert.equal(out.counts.total, 0);
    const out2 = scanTodos([{ path: "x.md", content: "NOTE: read me\nTODO: ignored now" }], ["NOTE"]);
    assert.equal(out2.counts.total, 1);
    assert.equal(out2.entries[0].marker, "NOTE");
  });
});

describe("scanTodos — input validation", () => {
  it("rejects an empty or malformed files list", () => {
    assert.throws(() => scanTodos([]), /files is required/);
    assert.throws(() => scanTodos("nope"), /files is required/);
    assert.throws(() => scanTodos([{ path: "a.ts" }]), /files\[0\] must be an object/);
    assert.throws(() => scanTodos([{ path: 1, content: "x" }]), /files\[0\] must be an object/);
  });

  it("rejects empty, blank, or whitespace-containing markers", () => {
    const files = [{ path: "a.ts", content: A }];
    assert.throws(() => scanTodos(files, []), /markers must be a non-empty list/);
    assert.throws(() => scanTodos(files, ["  "]), /markers\[0\] must be a non-blank string/);
    assert.throws(() => scanTodos(files, ["TO DO"]), /markers\[0\] must be a non-blank string/);
  });
});
