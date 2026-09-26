import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPaktaTools, httpApiClient } from "./tools.js";

/**
 * Pakta MCP server over stdio.
 *
 *   PAKTA_API_URL=http://localhost:4000 npx tsx apps/mcp/src/server.ts
 *
 * Holds no keys: every tool is a call to the Pakta API, which is where the
 * issuer and executor keys live. Register it with an MCP client (Claude
 * Desktop, Claude Code) as a stdio server running the command above.
 */
const server = new McpServer({ name: "pakta", version: "0.1.0" });
const api = httpApiClient(process.env.PAKTA_API_URL ?? "http://localhost:4000");

for (const tool of createPaktaTools(api)) {
  // The tuple of heterogeneous tools does not narrow per element here.
  server.registerTool(tool.name, tool.config as never, tool.handler as never);
}

await server.connect(new StdioServerTransport());
