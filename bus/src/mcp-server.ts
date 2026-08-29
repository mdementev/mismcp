import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { join } from "node:path"
import { homedir } from "node:os"
import { openStore } from "./store.js"

const agentId = (process.env.AGENT_ID ?? "").trim()
const busPath =
  (process.env.BUS_PATH ?? "").trim() || join(homedir(), ".mismcp", "bus.db")

const store = openStore(busPath)
const server = new McpServer({ name: "mismcp", version: "0.1.0" })

server.registerTool(
  "mismcp_bus_send",
  {
    title: "Send a message to another agent",
    description:
      "Send a message to another opencode agent over the shared bus. " +
      "CALL THIS TOOL DIRECTLY — do not research the bus, AGENT_ID, recipients, or source files; " +
      "your context already contains a line listing the online agents: " +
      "\"Available agents to ask via mismcp_bus_send: <id1, id2, ...>\". " +
      "Copy a recipient from that line verbatim. " +
      'Use type "question" to ask another agent something (they reply asynchronously via this same tool). ' +
      'Use type "answer" to reply to a question you received ("Question from X: ..."). ' +
      'Example: mismcp_bus_send(recipient: "tester", type: "question", content: "How are you?"). ' +
      "If you don't know a valid recipient ID, say so instead of guessing.",
    inputSchema: {
      recipient: z
        .string()
        .min(1)
        .describe(
          "AGENT_ID from the 'Available agents to ask via mismcp_bus_send:' line in your context, e.g. \"tester\"",
        ),
      content: z
        .string()
        .min(1)
        .describe('message body; for type "answer", put your full structured reply here'),
      type: z
        .enum(["question", "answer"])
        .describe('"question" = ask another agent; "answer" = reply to a received question'),
    },
  },
  async ({ recipient, content, type }) => {
    if (!agentId) {
      return {
        content: [{ type: "text", text: "AGENT_ID is not set — cannot send messages" }],
        isError: true,
      }
    }
    if (recipient === agentId) {
      return {
        content: [{ type: "text", text: `refusing to send a message to yourself ("${agentId}") — pick another agent from the roster` }],
        isError: true,
      }
    }
    const msg = store.send({ from: agentId, recipient, type, content })
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ id: msg.id, from: msg.from, created_at: msg.created_at }),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
