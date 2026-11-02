# tododebt — Build Report

MCP Rebuild 1000 (Tranche #101+ Batch 10). **Original build**
from the program's own packages-100 plan
(`~/workspace/packages-100/100-packages-plan.md`, cluster D
#45: "TODO/FIXME/HACK inventory with git-blame age and file
owner"), NOT a rebuild of an external server. The tool surface
is the program's defined spec, recorded in
`harness/fixtures/tododebt-tools-original.json` with its
`_source` labelled "program spec". Local build only — nothing
pushed or published.

Identity: repo `tododebt`, npm `@reneturcios/tododebt`,
MCP name `io.github.CloudCorpRecords/tododebt`, version
`0.1.0`, bin `tododebt` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Inventory TODO,
  FIXME, and HACK markers across source files, with counts by
  marker and file.", ≤100 chars; npm entry carries
  `version: 0.1.0`; OCI entry `ghcr.io/cloudcorprecords/tododebt:0.1.0`
  carries **no** `version` field), `Dockerfile`
  (node:20-alpine two-stage, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/tododebt"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright (c)
  2026 Rene Turcios), `README.md` (fresh text), `CHANGELOG.md`
  (single 0.1.0 entry, 2026-10-27)
- `src/index.ts`, `src/cli.ts` (`scan <file>... [--markers
  TODO,FIXME,HACK]`, `mcp`, `--version`; exit 2 usage / 1
  runtime error, argument validation before any file is read),
  `src/mcp.ts`, `src/types.ts`, `src/tododebt.ts` (core,
  `VERSION = "0.1.0"`)
- `test/tododebt.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`

## Tools implemented (1)

- `scan_todos` — `files` (array of {path, content}, required),
  `markers` (array of strings, optional; default TODO, FIXME,
  HACK).

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals exactly matching the fixture, per the
  standing fleet rule; zod still validates every `tools/call`.
- Marker matching requires a standalone token (marker followed
  by a non-letter), so `TODOS` / `METHOD` never match; only the
  first marker per line is reported; matching is
  case-sensitive. The core does no IO — the CLI reads the named
  files and supplies contents.
- Pure local computation: no network, no configuration.

## Verification (foreground, coordinator re-run)

- `tsc --noEmit` exit 0; `npm run build` exit 0 (`dist/cli.js`)
- `npm test`: **8 tests, 8 pass, 0 fail** — default marker set
  with 1-based lines and trimmed text, glued-letter
  non-matches, first-marker-per-line, by-marker/by-file counts,
  clean-file empty inventory, custom marker lists, files/markers
  validation errors
- `dist/cli.js --version` → `0.1.0`
- Parity: `harness/parity.py` vs
  `harness/fixtures/tododebt-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (program-spec
  fixture)

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy with
only `package.json`, offline `npm install --package-lock-only
--ignore-scripts --offline`), verified: parses, name
`@reneturcios/tododebt`, **128 package entries**. Local
`node_modules` is a symlink to the sibling burnmeter tree;
gitignored.

## Gaps / honest notes

- Program-spec build: the plan's line also names "git-blame age
  and file owner" enrichment; that enrichment is NOT in this
  build's surface (the core scans supplied contents only and
  shells out to nothing). The fixture's `_source` records the
  scope choice; a blame-fed variant is future work, not claimed
  here.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
