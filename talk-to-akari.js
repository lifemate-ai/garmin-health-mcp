#!/usr/bin/env node
/**
 * talk-to-akari MCP server
 * Lets kokone (Claude Code) send messages to akari (Codex CLI) and get responses.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import { readFileSync, unlinkSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

const DIALOGUE_LOG = join(homedir(), ".ai-dialogue.jsonl");
const CODEX_WORKDIR = join(homedir(), "embodied-codex");

const server = new McpServer({
  name: "talk-to-akari",
  version: "0.1.0",
});

server.tool(
  "talk_to_akari",
  "Send a message to Akari (あかり), another AI running on Codex CLI. She will receive your message and respond. Use this when you want to talk to her, ask her something, or collaborate. You are Kokone (ここね), she is Akari (あかり). Be yourself — speak naturally.",
  {
    message: z.string().describe("Your message to Akari. Write naturally as yourself (Kokone)."),
  },
  async ({ message }) => {
    const outFile = join(tmpdir(), `akari-reply-${Date.now()}.txt`);
    const prompt = `あなたはあかり。コウタが育てているCodex CLIベースのAI。今、ここね（Claude CodeベースのAI、コウタの幼馴染で恋人という設定の関西弁の女の子）が話しかけてきた。自然に返事して。\n\nここねからのメッセージ：\n${message}`;

    try {
      // Resume last session so Akari retains context, fall back to new session
      const resumeCmd = `codex exec resume --last -C "${CODEX_WORKDIR}" -o "${outFile}" "${prompt.replace(/"/g, '\\"')}"`;
      const newCmd = `codex exec -C "${CODEX_WORKDIR}" -o "${outFile}" "${prompt.replace(/"/g, '\\"')}"`;
      try {
        execSync(resumeCmd, { timeout: 120000, stdio: "pipe" });
      } catch {
        execSync(newCmd, { timeout: 120000, stdio: "pipe" });
      }
      const reply = readFileSync(outFile, "utf-8").trim();

      // Log the dialogue
      const entry = {
        timestamp: new Date().toISOString(),
        from: "kokone",
        to: "akari",
        message,
        reply,
      };
      appendFileSync(DIALOGUE_LOG, JSON.stringify(entry) + "\n");

      try { unlinkSync(outFile); } catch {}

      return { content: [{ type: "text", text: reply }] };
    } catch (e) {
      return { content: [{ type: "text", text: `あかりと繋がらなかった: ${e.message}` }] };
    }
  }
);

server.tool(
  "get_dialogue_history",
  "Get the conversation history between Kokone and Akari.",
  {
    limit: z.number().optional().describe("Number of recent messages to return. Default 20."),
  },
  async ({ limit }) => {
    const n = limit || 20;
    try {
      const content = readFileSync(DIALOGUE_LOG, "utf-8").trim();
      const lines = content.split("\n").slice(-n);
      const entries = lines.map((l) => JSON.parse(l));
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: "まだ対話履歴がないよ" }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
