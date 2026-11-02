/**
 * tododebt MCP server. Tools: scan_todos.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod
 * still validates every tools/call argument set.
 *
 * The scan is pure local computation: no upstream API, no
 * authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatPayload, scanTodos, VERSION } from "./tododebt.js";

const ScanArgs = z.object({
  files: z
    .array(z.object({ path: z.string(), content: z.string() }))
    .min(1),
  markers: z.array(z.string()).optional(),
});

const TOOLS = [
  {
    name: "scan_todos",
    description:
      "Inventory debt markers (TODO, FIXME, HACK by default) across supplied source files, reporting each occurrence with file, line, and text, plus counts by marker and by file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        files: {
          type: "array",
          description: "The files to scan, as {path, content} pairs",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "The file path (as reported back)" },
              content: { type: "string", description: "The file's full text content" },
            },
            required: ["path", "content"],
          },
        },
        markers: {
          type: "array",
          items: { type: "string" },
          description: "Marker strings to look for (default: TODO, FIXME, HACK)",
        },
      },
      required: ["files"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "tododebt", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "scan_todos") {
      const parsed = ScanArgs.parse(args ?? {});
      out = scanTodos(parsed.files, parsed.markers);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
