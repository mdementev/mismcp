import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { join } from "node:path"
import { openStore } from "./store"

const agentId = (process.env.AGENT_ID ?? "").trim()
const busPath = (process.env.BUS_PATH ?? "").trim() || join(process.cwd(), ".mismcp", "bus.db")

const store = openStore(busPath)
const server = new McpServer({ name: "mismcp", version: "0.1.0" })

server.registerTool(
  "bus_send",
  {
    title: "Send a message to another agent",
    description:
      "Send a message to another agent on the shared bus. " +
      "recipient is the AGENT_ID of another running opencode instance (see the roster injected into your context). " +
      'Use type "question" to ask, type "answer" to reply to a received question. ' +
      "When answering a question, put your full, structured answer in the content argument.",
    inputSchema: {
      recipient: z.string().min(1).describe("AGENT_ID of the receiving agent"),
      content: z.string().min(1).describe("message body"),
      type: z.enum(["question", "answer"]).describe("question to ask, or answer to a question"),
    },
  },
  async ({ recipient, content, type }) => {
    if (!agentId) {
      return {
        content: [{ type: "text", text: "AGENT_ID is not set — cannot send messages" }],
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
