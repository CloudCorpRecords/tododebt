/**
 * Pipe regression tests, inherited from the factory emit contract
 * (FACTORY-NOTES.md; ledger P-001, P-017, P-021 in the tranche 1 tools).
 *
 * Node stdout attached to a pipe is asynchronous: console.log followed
 * by process.exit discards whatever the pipe has not drained, truncating
 * at one 64 KiB pipe buffer while the exit code still reports success.
 * These tests spawn the real CLI with piped stdio and push a report past
 * 200 KiB through the pipe. The fixture tree lives in a non-git temp
 * dir so git blame ageing stays off and the run measures the pipe,
 * not git.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runCheck, renderReport } from "../src/core.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tododebt-pipe-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Many files, one TODO each, so the JSON report grows past 200 KiB. */
function writeBigTree(root: string, fileCount = 3000): void {
  for (let f = 0; f < fileCount; f++) {
    const id = String(f).padStart(4, "0");
    writeFileSync(
      join(root, `f${id}.ts`),
      `// TODO: debt item ${id} with descriptive padding text for bulk\nconst v${id} = ${f};\n`,
      "utf8",
    );
  }
}

interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { destroyStdoutOnFirstChunk?: boolean } = {}): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error("CLI timed out"));
    }, 90000);
    if (opts.destroyStdoutOnFirstChunk) {
      child.stdout.destroy();
    }
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
      if (opts.destroyStdoutOnFirstChunk) child.stdout.destroy();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout: out, stderr: err });
    });
  });
}

describe("emit contract: piped output is delivered whole", () => {
  it("piped --json scan over 200 KiB parses and matches the in-process report", { timeout: 120000 }, async () => {
    writeBigTree(dir);
    const direct = runCheck(dir);
    const directJson = JSON.stringify(direct, null, 2);
    assert.ok(directJson.length > 200_000, `fixture must exceed 200 KiB of JSON, got ${directJson.length}`);
    assert.equal(direct.counts.total, 3000);
    const res = await runCli(["scan", dir, "--json"]);
    assert.equal(res.code, 1, `expected exit 1 (DEBT), got ${res.code} (stderr: ${res.stderr.slice(0, 200)})`);
    assert.equal(res.stdout.length, directJson.length + 1, "piped bytes must equal the full report plus the trailing newline");
    const parsed = JSON.parse(res.stdout) as { counts: { total: number }; verdict: string };
    assert.equal(parsed.counts.total, direct.counts.total);
    assert.equal(parsed.verdict, direct.verdict);
  });

  it("piped human scan output is byte-identical to the in-process render", { timeout: 120000 }, async () => {
    writeBigTree(dir);
    const expected = renderReport(runCheck(dir)) + "\n";
    assert.ok(expected.length > 65_536, `human fixture must exceed one pipe buffer, got ${expected.length}`);
    const res = await runCli(["scan", dir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout, expected);
  });

  it("a reader that closes the pipe early never sees a success exit", { timeout: 120000 }, async () => {
    writeBigTree(dir);
    const res = await runCli(["scan", dir, "--json"], { destroyStdoutOnFirstChunk: true });
    assert.notEqual(res.code, 0, "exit 0 would report success for output that was never delivered");
    assert.ok(res.signal === "SIGPIPE" || res.code === 141, `expected SIGPIPE or exit 141, got code ${res.code} signal ${res.signal}`);
  });
});
