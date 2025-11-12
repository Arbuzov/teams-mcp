#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeviceCodeCredential } from "@azure/identity";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GraphService } from "./services/graph.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerChatTools } from "./tools/chats.js";
import { registerSearchTools } from "./tools/search.js";
import { registerTeamsTools } from "./tools/teams.js";
import { registerUsersTools } from "./tools/users.js";

const CLIENT_ID =
  process.env.TEAMS_MCP_CLIENT_ID ?? process.env.CLIENT_ID;

if (!CLIENT_ID) {
  console.error(
    "Missing client ID. Set TEAMS_MCP_CLIENT_ID (or CLIENT_ID) in the environment."
  );
  process.exit(1);
}
const TOKEN_PATH = join(homedir(), ".msgraph-mcp-auth.json");

// Authentication functions
async function authenticate() {
  console.log("🔐 Microsoft Graph Authentication for MCP Server");
  console.log("=".repeat(50));

  try {
    const credential = new DeviceCodeCredential({
      clientId: <string>CLIENT_ID,
      tenantId: "common",
      userPromptCallback: (info) => {
        console.log("\n📱 Please complete authentication:");
        console.log(`🌐 Visit: ${info.verificationUri}`);
        console.log(`🔑 Enter code: ${info.userCode}`);
        console.log("\n⏳ Waiting for you to complete authentication...");
      },
    });

    // Get the actual token
    const token = await credential.getToken([
      "User.Read",
      "User.ReadBasic.All",
      //"Team.ReadBasic.All",
      "Channel.ReadBasic.All",
      "ChannelMessage.Read.All",
      "ChannelMessage.Send",
      "TeamMember.Read.All",
      "Chat.ReadBasic",
      "Chat.ReadWrite",
    ]);

    if (token) {
      // Save authentication info with the actual token
      const authInfo = {
        clientId: CLIENT_ID,
        authenticated: true,
        timestamp: new Date().toISOString(),
        expiresAt: token.expiresOnTimestamp
          ? new Date(token.expiresOnTimestamp).toISOString()
          : undefined,
        token: token.token, // Save the actual access token
      };

      await fs.writeFile(TOKEN_PATH, JSON.stringify(authInfo, null, 2));

      console.log("\n✅ Authentication successful!");
      console.log(`💾 Credentials saved to: ${TOKEN_PATH}`);
      console.log("\n🚀 You can now use the MCP server in Cursor!");
      console.log("   The server will automatically use these credentials.");
    }
  } catch (error) {
    console.error(
      "\n❌ Authentication failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

async function checkAuth() {
  try {
    const data = await fs.readFile(TOKEN_PATH, "utf8");
    const authInfo = JSON.parse(data);

    if (authInfo.authenticated && authInfo.clientId) {
      console.log("✅ Authentication found");
      console.log(`📅 Authenticated on: ${authInfo.timestamp}`);

      // Check if we have expiration info
      if (authInfo.expiresAt) {
        const expiresAt = new Date(authInfo.expiresAt);
        const now = new Date();

        if (expiresAt > now) {
          console.log(`⏰ Token expires: ${expiresAt.toLocaleString()}`);
          console.log("🎯 Ready to use with MCP server!");
        } else {
          console.log("⚠️  Token may have expired - please re-authenticate");
          return false;
        }
      } else {
        console.log("🎯 Ready to use with MCP server!");
      }
      return true;
    }
  } catch (_error) {
    console.log("❌ No authentication found");
    return false;
  }
  return false;
}

async function logout() {
  try {
    await fs.unlink(TOKEN_PATH);
    console.log("✅ Successfully logged out");
    console.log("🔄 Run 'npx @spacebridge/teams-mcp@latest authenticate' to re-authenticate");
  } catch (_error) {
    console.log("ℹ️  No authentication to clear");
  }
}

// MCP Server setup
async function startMcpServer() {
  // Create MCP server
  const server = new McpServer({
    name: "teams-mcp",
    version: "0.3.3",
  });

  // Initialize Graph service (singleton)
  const graphService = GraphService.getInstance();

  // Register all tools
  registerAuthTools(server, graphService);
  registerUsersTools(server, graphService);
  registerTeamsTools(server, graphService);
  registerChatTools(server, graphService);
  registerSearchTools(server, graphService);

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Microsoft Graph MCP Server started");
}

// Main function to handle both CLI and MCP server modes
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // CLI commands
  switch (command) {
    case "authenticate":
    case "auth":
      await authenticate();
      return;
    case "check":
      await checkAuth();
      return;
    case "logout":
      await logout();
      return;
    case "help":
    case "--help":
    case "-h":
      console.log("Microsoft Graph MCP Server");
      console.log("");
      console.log("Usage:");
      console.log(
        "  npx @spacebridge/teams-mcp@latest authenticate # Authenticate with Microsoft"
      );
      console.log(
        "  npx @spacebridge/teams-mcp@latest check        # Check authentication status"
      );
      console.log("  npx @spacebridge/teams-mcp@latest logout       # Clear authentication");
      console.log("  npx @spacebridge/teams-mcp@latest              # Start MCP server (default)");
      return;
    case undefined:
      // No command = start MCP server
      await startMcpServer();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Use --help to see available commands");
      process.exit(1);
  }
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

main().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
