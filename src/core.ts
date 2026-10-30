/**
 * tododebt core: inventory TODO-class debt markers in a repo.
 *
 * Scan model:
 * - Walk the target directory recursively in sorted order, skipping
 *   node_modules, .git, dist, and any directory named test, tests, or
 *   fixtures. The scan target itself is never skipped, even when its
 *   own name matches a skipped name: only child directories are.
 * - Source files are .ts, .js, .mjs, .cjs, .tsx, .jsx, .py, .rb,
 *   .go, .rs, .java, .c, .cpp, .h, and .sh files. Markdown (.md) is
 *   excluded on purpose because docs legitimately discuss markers.
 * - Markers are TODO, FIXME, HACK, and XXX. NOTE is not a marker.
 *   Matching is case-sensitive uppercase with word boundaries, so
 *   TODOLIST does not match, a lowercase todo does not match, and a
 *   method call like .todo( does not match. Each line contributes at
 *   most one finding: the first (leftmost) marker on the line.
 * - A marker inside a string still counts. Static text cannot tell a
 *   string literal from a comment, so the detector counts its own
 *   source the same way it counts any other file.
 * - Caps: at most 5000 files are scanned and at most 512 KiB per
 *   file is read. Files past either cap are counted, never silent.
 * - Age is best-effort: when the target is inside a git repo, each
 *   finding is dated with git blame for its exact line, capped at
 *   100 blame calls per run. Untracked files and non-repo targets
 *   leave the age unknown.
 *
 * Deterministic output only: files are walked in sorted order,
 * findings are ordered by file then line, and no timestamps are
 * emitted. Blame dates come from git history, not from the clock.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { Finding, Report, Severity } from "./types.js";

export const VERSION = "0.1.0";
export const CLEAN_VERDICT = "NONE";
export const DEBT_VERDICT = "DEBT";

export const MAX_FILES = 5000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_BLAME_CALLS = 100;

const MARKERS = ["TODO", "FIXME", "HACK", "XXX"] as const;
type Marker = (typeof MARKERS)[number];

const SEVERITY_BY_MARKER: Record<Marker, Severity> = {
  FIXME: "high",
  HACK: "medium",
  TODO: "medium",
  XXX: "low",
};

const SOURCE_EXTS: ReadonlySet<string> = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".sh",
]);

const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "test",
  "tests",
  "fixtures",
]);

const MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b/;

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

/**
 * Scan raw text for markers. Pure and git-free: runCheck layers file
 * walking and blame ageing on top of this. Exported for tests.
 */
export function scanText(text: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const match = MARKER_RE.exec(raw);
    if (!match) continue;
    const marker = match[1] as Marker;
    findings.push({
      rule: `MARKER-${marker}`,
      severity: SEVERITY_BY_MARKER[marker],
      file,
      line: i + 1,
      message: `${marker} debt marker`,
      evidence: raw.trim().slice(0, 200),
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

interface DiscoveredFile {
  abs: string;
  rel: string;
}

function collectSourceFiles(root: string, dir: string, out: DiscoveredFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(root, abs, out);
    } else if (entry.isFile()) {
      if (SOURCE_EXTS.has(extOf(entry.name))) {
        out.push({ abs, rel: relative(root, abs).split(sep).join("/") });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Git blame ageing                                                    */
/* ------------------------------------------------------------------ */

function gitTopLevel(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const top = out.trim();
    return top === "" ? null : top;
  } catch {
    return null;
  }
}

function blameDate(repoRoot: string, absFile: string, line: number): string | null {
  try {
    const relToRepo = relative(repoRoot, absFile).split(sep).join("/");
    const pathArg = relToRepo !== "" && !relToRepo.startsWith("..") ? relToRepo : absFile;
    const out = execFileSync(
      "git",
      ["blame", "--line-porcelain", "-L", `${line},${line}`, "--", pathArg],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024,
      },
    );
    const match = /^author-time (\d+)$/m.exec(out);
    if (!match || !match[1]) return null;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const date = new Date(seconds * 1000).toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Main check                                                          */
/* ------------------------------------------------------------------ */

export function runCheck(target: string): Report {
  const root = resolve(target);
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    throw new Error(`target does not exist: ${target}`);
  }

  const discovered: DiscoveredFile[] = [];
  if (rootStat.isFile()) {
    if (SOURCE_EXTS.has(extOf(root))) {
      discovered.push({ abs: root, rel: basename(root) });
    }
  } else if (rootStat.isDirectory()) {
    collectSourceFiles(root, root, discovered);
  } else {
    throw new Error(`target is neither a directory nor a file: ${target}`);
  }
  discovered.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const filesSeen = discovered.length;
  const findings: Finding[] = [];
  let filesScanned = 0;
  let oversizeSkipped = 0;
  let capped = 0;

  for (const file of discovered) {
    if (filesScanned >= MAX_FILES) {
      capped += 1;
      continue;
    }
    let size: number;
    try {
      size = statSync(file.abs).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      oversizeSkipped += 1;
      continue;
    }
    let content: string;
    try {
      content = readFileSync(file.abs, "utf8");
    } catch {
      continue;
    }
    filesScanned += 1;
    findings.push(...scanText(content, file.rel));
  }

  findings.sort((a, b) => {
    const fa = a.file ?? "";
    const fb = b.file ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });

  /* Age findings with git blame, capped, one try per finding. */
  const dates: (string | null)[] = findings.map(() => null);
  if (findings.length > 0) {
    const gitCwd = rootStat.isDirectory() ? root : resolve(root, "..");
    const repoRoot = gitTopLevel(gitCwd);
    if (repoRoot !== null) {
      const limit = Math.min(findings.length, MAX_BLAME_CALLS);
      for (let i = 0; i < limit; i++) {
        const finding = findings[i] as Finding;
        if (!finding.file || !finding.line) continue;
        const absFile = rootStat.isFile() ? root : join(root, finding.file);
        const date = blameDate(repoRoot, absFile, finding.line);
        if (date !== null) {
          dates[i] = date;
          const base = finding.evidence ?? "";
          finding.evidence = `${base} (since ${date})`;
        }
      }
    }
  }

  let aged = 0;
  let oldestDate: string | null = null;
  let oldestFinding: Finding | null = null;
  for (let i = 0; i < findings.length; i++) {
    const date = dates[i] ?? null;
    if (date !== null) {
      aged += 1;
      if (oldestDate === null || date < oldestDate) {
        oldestDate = date;
        oldestFinding = findings[i] ?? null;
      }
    }
  }
  const unaged = findings.length - aged;

  const perMarker: Record<Marker, number> = { TODO: 0, FIXME: 0, HACK: 0, XXX: 0 };
  const filesWithDebtSet = new Set<string>();
  for (const finding of findings) {
    for (const marker of MARKERS) {
      if (finding.rule === `MARKER-${marker}`) perMarker[marker] += 1;
    }
    if (finding.file) filesWithDebtSet.add(finding.file);
  }
  const filesWithDebt = filesWithDebtSet.size;

  const counts: Record<string, number> = {
    total: findings.length,
    TODO: perMarker.TODO,
    FIXME: perMarker.FIXME,
    HACK: perMarker.HACK,
    XXX: perMarker.XXX,
    filesWithDebt,
    filesScanned,
    filesSeen,
    oversizeSkipped,
    capped,
    aged,
    unaged,
  };

  const verdict = findings.length === 0 ? CLEAN_VERDICT : DEBT_VERDICT;

  let summary: string;
  if (findings.length === 0) {
    summary = `NONE: no TODO, FIXME, HACK, or XXX markers found in ${filesScanned} scanned file(s).`;
  } else {
    summary =
      `DEBT: ${findings.length} marker(s) in ${filesWithDebt} file(s): ` +
      `TODO ${perMarker.TODO}, FIXME ${perMarker.FIXME}, HACK ${perMarker.HACK}, XXX ${perMarker.XXX}; ` +
      `aged ${aged}, unaged ${unaged}.`;
    if (oldestDate !== null && oldestFinding !== null) {
      const loc = oldestFinding.file
        ? `${oldestFinding.file}${oldestFinding.line ? `:${oldestFinding.line}` : ""}`
        : "unknown file";
      summary += ` Oldest: ${loc} since ${oldestDate}.`;
    }
  }
  if (capped > 0) {
    summary += ` File cap reached: ${capped} file(s) past the ${MAX_FILES} file cap were not scanned.`;
  }
  if (oversizeSkipped > 0) {
    summary += ` Oversize: ${oversizeSkipped} file(s) over the ${MAX_FILE_BYTES} byte cap were not scanned.`;
  }

  return {
    tool: "tododebt",
    version: VERSION,
    target,
    verdict,
    counts,
    findings,
    summary,
  };
}

export function renderReport(report: Report): string {
  const out: string[] = [];
  out.push(`tododebt scan ${report.target}: ${report.verdict}`);
  out.push(`  ${report.summary}`);
  const c = report.counts;
  out.push(
    `  counts: total ${c.total ?? 0}, TODO ${c.TODO ?? 0}, FIXME ${c.FIXME ?? 0}, ` +
      `HACK ${c.HACK ?? 0}, XXX ${c.XXX ?? 0}, files with debt ${c.filesWithDebt ?? 0}, ` +
      `files scanned ${c.filesScanned ?? 0}, files seen ${c.filesSeen ?? 0}, ` +
      `aged ${c.aged ?? 0}, unaged ${c.unaged ?? 0}`,
  );
  if ((c.oversizeSkipped ?? 0) > 0 || (c.capped ?? 0) > 0) {
    out.push(
      `  caps: oversize skipped ${c.oversizeSkipped ?? 0}, capped ${c.capped ?? 0} ` +
        `(max ${MAX_FILES} files, max ${MAX_FILE_BYTES} bytes per file)`,
    );
  }
  out.push(`  findings (${report.findings.length}):`);
  if (report.findings.length === 0) {
    out.push("    none");
  } else {
    for (const f of report.findings) {
      const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
      const ev = f.evidence ? ` - ${f.evidence}` : "";
      out.push(`    [${f.severity.toUpperCase()}]${loc} ${f.rule} ${f.message}${ev}`);
    }
  }
  if (report.verdict === CLEAN_VERDICT) {
    out.push("NONE: no debt markers found in the scanned source files.");
  } else {
    out.push("DEBT: at least one debt marker was found. See findings above.");
  }
  return out.join("\n");
}
