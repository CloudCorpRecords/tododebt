/**
 * tododebt MCP server. Tool: scan_todo_debt.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCheck, VERSION } from "./core.js";

const server = new McpServer({ name: "tododebt", version: VERSION });

server.tool(
  "scan_todo_debt",
  "Scan a repo for TODO, FIXME, HACK, and XXX markers in source files: each finding carries file, line, marker, and text; counts are grouped by marker and by file; when git history is available, blame dates the oldest markers. Verdict NONE when the tree is clean, DEBT otherwise.",
  {
    path: z.string().describe("Target path to check"),
  },
  async ({ path }) => {
    const report = runCheck(path);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
