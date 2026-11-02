/**
 * tododebt types.
 *
 * tododebt inventories the debt markers — TODO, FIXME, HACK by
 * default — across a set of source files given as {path, content}
 * pairs. It reports every marker occurrence with its file,
 * 1-based line number, marker, and the line's text, plus counts
 * in total, by marker, and by file. It reads nothing from disk
 * and nothing from the network: the caller supplies the file
 * contents.
 */

/** One file to scan, as supplied by the caller. */
export interface SourceFile {
  path: string;
  content: string;
}

/** One marker occurrence. */
export interface TodoEntry {
  path: string;
  /** 1-based line number. */
  line: number;
  /** The marker that matched (e.g. "TODO"). */
  marker: string;
  /** The full line, trimmed. */
  text: string;
}

/** The inventory report. */
export interface TodoDebtResult {
  entries: TodoEntry[];
  counts: {
    total: number;
    by_marker: Record<string, number>;
    by_file: Record<string, number>;
  };
}
