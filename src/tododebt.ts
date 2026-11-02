/**
 * tododebt core: TODO / FIXME / HACK inventory over supplied
 * file contents.
 *
 *   scanTodos(files, markers?) -> TodoDebtResult
 *
 * A line counts when it contains a marker as a standalone token:
 * the marker followed by a non-letter (so `TODOS` and `METHOD`
 * never match `TODO`, but `TODO:`, `TODO(user)`, and `// TODO`
 * do). Only the first marker on a line is reported. Matching is
 * case-sensitive — markers are conventionally uppercase.
 *
 * The default marker set is TODO, FIXME, HACK (the program
 * spec's set). Callers may substitute their own list; an empty
 * list, a blank marker, or a marker containing whitespace is an
 * error. Files must be a non-empty list of {path, content}
 * string pairs. All validation errors name the offending input —
 * never a fabricated empty inventory.
 */
import type { SourceFile, TodoDebtResult, TodoEntry } from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_MARKERS = ["TODO", "FIXME", "HACK"] as const;

function findMarker(line: string, markers: string[]): string | null {
  let best: { marker: string; index: number } | null = null;
  for (const marker of markers) {
    let from = 0;
    for (;;) {
      const index = line.indexOf(marker, from);
      if (index < 0) break;
      const next = line[index + marker.length];
      if (next === undefined || !/[A-Za-z]/.test(next)) {
        if (!best || index < best.index) best = { marker, index };
        break;
      }
      from = index + 1;
    }
  }
  return best?.marker ?? null;
}

/** Inventory debt markers across the supplied files. */
export function scanTodos(files: unknown, markersInput?: unknown): TodoDebtResult {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files is required and must be a non-empty list of {path, content} entries");
  }
  const parsed: SourceFile[] = files.map((entry, i) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as SourceFile).path !== "string" ||
      typeof (entry as SourceFile).content !== "string"
    ) {
      throw new Error(`files[${i}] must be an object with string path and content`);
    }
    return entry as SourceFile;
  });

  let markers: string[] = [...DEFAULT_MARKERS];
  if (markersInput !== undefined) {
    if (!Array.isArray(markersInput) || markersInput.length === 0) {
      throw new Error("markers must be a non-empty list of marker strings");
    }
    markers = markersInput.map((m, i) => {
      if (typeof m !== "string" || !m.trim() || /\s/.test(m)) {
        throw new Error(`markers[${i}] must be a non-blank string without whitespace`);
      }
      return m;
    });
  }

  const entries: TodoEntry[] = [];
  const byMarker: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const file of parsed) {
    const lines = file.content.split("\n");
    lines.forEach((rawLine, index) => {
      const marker = findMarker(rawLine, markers);
      if (marker) {
        entries.push({ path: file.path, line: index + 1, marker, text: rawLine.trim() });
        byMarker[marker] = (byMarker[marker] ?? 0) + 1;
        byFile[file.path] = (byFile[file.path] ?? 0) + 1;
      }
    });
  }
  return {
    entries,
    counts: { total: entries.length, by_marker: byMarker, by_file: byFile },
  };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
