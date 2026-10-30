/**
 * tododebt core tests: scanText unit cases, fixture trees, and a git
 * blame ageing test against a temp repo with a fixed commit date.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanText, runCheck, renderReport, VERSION, CLEAN_VERDICT } from "../src/core.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

describe("scanText: markers and severities", () => {
  it("finds TODO at medium severity with rule, file, line, and evidence", () => {
    const found = scanText("const a = 1;\n// TODO: wire this up\n", "src/a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-TODO");
    assert.equal(found[0]?.severity, "medium");
    assert.equal(found[0]?.file, "src/a.ts");
    assert.equal(found[0]?.line, 2);
    assert.equal(found[0]?.evidence, "// TODO: wire this up");
  });

  it("finds FIXME at high severity", () => {
    const found = scanText("// FIXME: crashes on empty input\n", "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-FIXME");
    assert.equal(found[0]?.severity, "high");
  });

  it("finds HACK at medium severity", () => {
    const found = scanText("# HACK: workaround\n", "a.py");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-HACK");
    assert.equal(found[0]?.severity, "medium");
  });

  it("finds XXX at low severity", () => {
    const found = scanText("// XXX: revisit\n", "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-XXX");
    assert.equal(found[0]?.severity, "low");
  });

  it("counts a marker inside a string, because static text cannot tell", () => {
    const found = scanText('const label = "TODO in a string";\n', "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-TODO");
  });

  it("trims evidence and caps it at 200 chars", () => {
    const long = `   // TODO: ${"x".repeat(300)}   `;
    const found = scanText(long + "\n", "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.evidence?.length, 200);
    assert.ok(found[0]?.evidence?.startsWith("// TODO:"));
  });

  it("returns nothing for empty text", () => {
    assert.deepEqual(scanText("", "a.ts"), []);
  });
});

describe("scanText: what does not match", () => {
  it("TODOLIST must not match: word boundary after the marker", () => {
    assert.deepEqual(scanText("// TODOLIST is one word\n", "a.ts"), []);
    assert.deepEqual(scanText("const TODOLIST = [];\n", "a.ts"), []);
  });

  it("a method named .todo( must not match: lowercase is skipped", () => {
    assert.deepEqual(scanText("obj.todo();\n", "a.ts"), []);
    assert.deepEqual(scanText("// todo: lowercase note\n", "a.ts"), []);
  });

  it("NOTE is not a marker", () => {
    assert.deepEqual(scanText("// NOTE: remember this\n", "a.ts"), []);
  });

  it("a marker glued to a preceding word char must not match", () => {
    assert.deepEqual(scanText("const MYTODO = 1;\n", "a.ts"), []);
  });
});

describe("scanText: one finding per line, first marker wins", () => {
  it("TODO before FIXME counts TODO only", () => {
    const found = scanText("// TODO and FIXME together\n", "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-TODO");
  });

  it("FIXME before TODO counts FIXME only", () => {
    const found = scanText("// FIXME and TODO together\n", "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-FIXME");
  });

  it("the leftmost marker wins even when it is XXX", () => {
    const found = scanText("// XXX then TODO\n", "a.ts");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "MARKER-XXX");
  });

  it("separate lines each count once", () => {
    const found = scanText("// TODO: one\n// TODO: two\n", "a.ts");
    assert.equal(found.length, 2);
    assert.equal(found[0]?.line, 1);
    assert.equal(found[1]?.line, 2);
  });
});

describe("fixture trees", () => {
  it("tree-debt: known markers at known lines, skips and exclusions applied", () => {
    const r = runCheck(join(FIXTURES, "tree-debt"));
    assert.equal(r.tool, "tododebt");
    assert.equal(r.version, VERSION);
    assert.equal(r.verdict, "DEBT");
    assert.equal(r.counts.total, 6, JSON.stringify(r.findings, null, 2));
    assert.equal(r.counts.TODO, 3);
    assert.equal(r.counts.FIXME, 1);
    assert.equal(r.counts.HACK, 1);
    assert.equal(r.counts.XXX, 1);
    assert.equal(r.counts.filesWithDebt, 3);
    // a.ts, b.py, sub/c.js, sub/clean.go are scanned. docs.md is
    // excluded, fixtures/hidden.ts and test/ignored.ts are skipped.
    assert.equal(r.counts.filesScanned, 4);
    assert.equal(r.counts.filesSeen, 4);
    assert.equal(r.counts.oversizeSkipped, 0);
    assert.equal(r.counts.capped, 0);
    assert.equal((r.counts.aged ?? 0) + (r.counts.unaged ?? 0), r.counts.total);

    const locs = r.findings.map((f) => `${f.file}:${f.line}:${f.rule}`);
    assert.deepEqual(locs, [
      "a.ts:1:MARKER-TODO",
      "a.ts:3:MARKER-FIXME",
      "a.ts:5:MARKER-TODO",
      "b.py:1:MARKER-HACK",
      "b.py:2:MARKER-XXX",
      "sub/c.js:2:MARKER-TODO",
    ]);
    assert.ok(
      r.findings.every((f) => !(f.file ?? "").includes("fixtures/") && !(f.file ?? "").startsWith("test/")),
      "skipped directories must contribute no findings",
    );
    assert.ok(
      r.findings.every((f) => !(f.file ?? "").endsWith(".md")),
      "Markdown files must contribute no findings",
    );
    assert.match(renderReport(r), /DEBT/);
    assert.match(r.summary, /DEBT: 6 marker\(s\) in 3 file\(s\)/);
  });

  it("tree-clean: verdict NONE with zero findings", () => {
    const r = runCheck(join(FIXTURES, "tree-clean"));
    assert.equal(r.verdict, CLEAN_VERDICT);
    assert.equal(r.verdict, "NONE");
    assert.equal(r.counts.total, 0);
    assert.equal(r.findings.length, 0);
    assert.equal(r.counts.filesWithDebt, 0);
    assert.match(renderReport(r), /NONE/);
  });

  it("a single file target scans just that file", () => {
    const r = runCheck(join(FIXTURES, "tree-debt", "a.ts"));
    assert.equal(r.counts.total, 3);
    assert.equal(r.counts.filesWithDebt, 1);
    assert.equal(r.verdict, "DEBT");
  });
});

describe("git blame ageing", () => {
  it(
    "a committed TODO carries its commit date in the evidence",
    { skip: !hasGit() },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "tododebt-age-"));
      try {
        const git = (args: string[], env?: Record<string, string>): string =>
          execFileSync("git", args, {
            cwd: dir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: env ? { ...process.env, ...env } : process.env,
          });
        git(["init", "-q"]);
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test User"]);
        writeFileSync(join(dir, "debt.ts"), "// header\n// TODO: old debt\n", "utf8");
        git(["add", "debt.ts"]);
        git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "add debt"], {
          GIT_AUTHOR_DATE: "2024-03-15T12:00:00Z",
          GIT_COMMITTER_DATE: "2024-03-15T12:00:00Z",
        });
        const r = runCheck(dir);
        assert.equal(r.counts.total, 1, JSON.stringify(r.findings, null, 2));
        assert.equal(r.counts.aged, 1);
        assert.equal(r.counts.unaged, 0);
        assert.ok(
          (r.findings[0]?.evidence ?? "").includes("since 2024-03-15"),
          `evidence must carry the blame date, got: ${r.findings[0]?.evidence}`,
        );
        assert.match(r.summary, /Oldest: debt\.ts:2 since 2024-03-15/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("an untracked file in a repo stays unaged", { skip: !hasGit() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "tododebt-unaged-"));
    try {
      const git = (args: string[]): string =>
        execFileSync("git", args, {
          cwd: dir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      git(["init", "-q"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test User"]);
      writeFileSync(join(dir, "tracked.ts"), "const a = 1;\n", "utf8");
      git(["add", "tracked.ts"]);
      git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]);
      writeFileSync(join(dir, "loose.ts"), "// TODO: never committed\n", "utf8");
      const r = runCheck(dir);
      assert.equal(r.counts.total, 1);
      assert.equal(r.counts.aged, 0);
      assert.equal(r.counts.unaged, 1);
      assert.ok(!(r.findings[0]?.evidence ?? "").includes("since "));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
