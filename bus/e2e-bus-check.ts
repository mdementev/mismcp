import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { openStore } from "./src/store.js"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, rmSync } from "node:fs"

const busPath = join(mkdtempSync(join(tmpdir(), "mismcp-e2e-")), "bus.db")

async function spawn(agentId: string) {
  const client = new Client({ name: "probe", version: "0.0.1" })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", "dist/mcp-server.js"],
    env: { ...process.env, AGENT_ID: agentId, BUS_PATH: busPath },
  })
  await client.connect(transport)
  return { client, transport }
}

const tester = await spawn("tester")
const expert = await spawn("sut_expert")

const tools = await tester.client.listTools()
console.log("tools:", tools.tools.map((t) => t.name).join(", "))

const q = await tester.client.callTool({
  name: "mismcp_bus_send",
  arguments: { recipient: "sut_expert", type: "question", content: "what is 2+2?" },
})
console.log("tester send question ->", q.content)

const a = await expert.client.callTool({
  name: "mismcp_bus_send",
  arguments: { recipient: "tester", type: "answer", content: "4" },
})
console.log("expert send answer ->", a.content)

const store = openStore(busPath)
const inboxExpert = store.inbox("sut_expert")
const inboxTester = store.inbox("tester")
console.log("inbox sut_expert:", inboxExpert.map((m) => `[${m.type}] ${m.from}: ${m.content}`))
console.log("inbox tester:", inboxTester.map((m) => `[${m.type}] ${m.from}: ${m.content}`))
console.log("roster:", store.agents())

for (const { client, transport } of [tester, expert]) {
  await client.close()
  transport.close()
}
rmSync(busPath, { recursive: true, force: true })
console.log("E2E BUS OK")
