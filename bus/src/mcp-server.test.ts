import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { rmSync } from "node:fs"
import { join } from "node:path"

const tmpDir = `${import.meta.dirname}/.tmp-mcp`
rmSync(tmpDir, { recursive: true, force: true })

async function withServer(fn: (client: Client) => Promise<void>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", join(import.meta.dirname, "mcp-server.js")],
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
  it("lists mismcp_bus_send tool", async () => {
    await withServer(async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      assert.ok(names.includes("mismcp_bus_send"))
    })
  })

  it("mismcp_bus_send stores a message", async () => {
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
      assert.equal(from, "tester")
      assert.ok(id)
      assert.ok(created_at > 0)
    })
  })

  it("mismcp_bus_send rejects sending to self", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({
        name: "mismcp_bus_send",
        arguments: { recipient: "tester", type: "question", content: "hello me?" },
      })
      assert.equal(res.isError, true)
    })
  })

  it("mismcp_bus_send rejects invalid type", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({
        name: "mismcp_bus_send",
        arguments: { recipient: "sut_expert", type: "bogus", content: "x" },
      })
      assert.equal(res.isError, true)
    })
  })
})