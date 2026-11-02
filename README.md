# tododebt

How much acknowledged debt is sitting in the codebase?
tododebt inventories the markers — `TODO`, `FIXME`, `HACK` by
default — across a set of source files and reports every
occurrence with its file, 1-based line number, and line text,
plus counts in total, by marker, and by file.

A marker counts only as a standalone token (the marker followed
by a non-letter), so `TODOS` and `METHOD` never false-positive,
while `TODO:`, `FIXME(user)`, and `// TODO` all count. Only the
first marker on a line is reported. Matching is case-sensitive.

The MCP tool takes file contents as input (no disk access); the
CLI reads the files you name. Pure local computation: no
network, no configuration.

## CLI

```bash
npx @reneturcios/tododebt scan src/*.ts
npx @reneturcios/tododebt scan README.md src/index.ts --markers TODO,XXX
npx @reneturcios/tododebt --version
```

Exit codes: `0` on success (a non-empty inventory is a *result*,
not an error), `1` on a runtime error (including an unreadable
file), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/tododebt mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "tododebt": {
      "command": "npx",
      "args": ["-y", "@reneturcios/tododebt", "mcp"]
    }
  }
}
```

### Tools

- `scan_todos` — Inventory debt markers across supplied source
  files.
  - `files` (array, required) — the files to scan, as
    `{path, content}` pairs
  - `markers` (array of strings, optional) — markers to look
    for; default `TODO`, `FIXME`, `HACK`

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/tododebt
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/tododebt scan /w/src/index.ts
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
