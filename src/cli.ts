#!/usr/bin/env node
/**
 * tododebt CLI.
 *
 *   tododebt scan <file> [more files...] [--markers TODO,FIXME,HACK]
 *   tododebt mcp
 *
 * The CLI reads the named files from disk and hands their
 * contents to the scanner; the core itself does no IO. Pure
 * local computation: no network, no configuration. Argument
 * validation happens before any file is read.
 * Exit codes: 0 success, 1 runtime error (including an
 * unreadable file), 2 usage error.
 */
import { readFileSync } from "node:fs";
import { formatPayload, scanTodos, VERSION } from "./tododebt.js";

function usage(): never {
  console.error(`Usage:
  tododebt scan <file> [more files...] [--markers TODO,FIXME,HACK]
  tododebt mcp
  tododebt --version`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function positionalArgs(rest: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (valueFlags.includes(rest[i])) {
      i++;
    } else {
      out.push(rest[i]);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd !== "scan") usage();

  // ---- Argument validation (before any file is read) ----
  if (rest.some((a) => a.startsWith("--") && a !== "--markers")) usage();
  const paths = positionalArgs(rest, ["--markers"]);
  if (paths.length === 0) usage();
  let markers: string[] | undefined;
  if (rest.includes("--markers")) {
    const raw = flag(rest, "--markers");
    if (raw === undefined || !raw.trim()) usage();
    markers = raw.split(",");
  }

  const files = paths.map((path) => {
    try {
      return { path, content: readFileSync(path, "utf8") };
    } catch (err) {
      console.error(
        `error: cannot read file '${path}': ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

  try {
    const out = scanTodos(files, markers);
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
