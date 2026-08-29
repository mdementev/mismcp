import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { rmSync } from "node:fs"
import { join } from "node:path"

const tmpDir = `${import.meta.dir}/.tmp-mcp`
rmSync(tmpDir, { recursive: true, force: true })

async function withServer(fn: (client: Client) => Promise<void>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", join(import.meta.dir, "mcp-server.ts")],
    env: {
      ...process.env,
      AGENT_ID: "tester",
      BUS_PATH: `${tmpDir}/bus.db`,
    },
  })
  const client = new Client({ name: "test", version: "0.0.1" })
  await client.connect(transport)
  try {
    await fn(client)
  } finally {
    await client.close()
  }
}

describe("mcp-server", () => {
  test("lists mismcp_bus_send tool", async () => {
    await withServer(async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain("mismcp_bus_send")
    })
  })

  test("mismcp_bus_send stores a message", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({
        name: "mismcp_bus_send",
        arguments: {
          recipient: "sut_expert",
          type: "question",
          content: "how does it work?",
        },
      })
      const content = res.content as Array<{ type: string; text?: string }>
      const text = content.find((c) => c.type === "text")?.text ?? ""
      const { id, from, created_at } = JSON.parse(text)
      expect(from).toBe("tester")
      expect(id).toBeTruthy()
      expect(created_at).toBeGreaterThan(0)
    })
  })

  test("mismcp_bus_send rejects sending to self", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({
        name: "mismcp_bus_send",
        arguments: { recipient: "tester", type: "question", content: "hello me?" },
      })
      expect(res.isError).toBe(true)
    })
  })

  test("mismcp_bus_send rejects invalid type", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({
        name: "mismcp_bus_send",
        arguments: { recipient: "sut_expert", type: "bogus", content: "x" },
      })
      expect(res.isError).toBe(true)
    })
  })
})
