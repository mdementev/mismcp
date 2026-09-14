import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Mismcp } from "../plugin/mismcp.ts"
import { openStore } from "./store.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type MockClient = {
  session: {
    list: () => Promise<{ data: unknown[] }>
    status: () => Promise<{ data: Record<string, { type: "busy" | "idle" | "retry" }> }>
    prompt: (opts: { path: { id: string }; body: { noReply?: boolean; parts: { type: string; text: string }[] } }) => Promise<unknown>
    promptAsync: (opts: { path: { id: string }; body: { noReply?: boolean; parts: { type: string; text: string }[] } }) => Promise<unknown>
  }
  app: {
    log: () => Promise<void>
  }
}

const directory = join(tmpdir(), "mismcp-plugin-test")

const makeSession = (id: string, status: "busy" | "idle") => ({
  id,
  projectID: "proj",
  directory,
  title: id,
  version: "1",
  time: { created: 1, updated: 1 },
})

const makeClient = (status: "busy" | "idle") => {
  const promptCalls: { path: { id: string }; body: { noReply?: boolean; parts: { type: string; text: string }[] } }[] = []
  const promptAsyncCalls: { path: { id: string }; body: { noReply?: boolean; parts: { type: string; text: string }[] } }[] = []
  const client: MockClient = {
    session: {
      list: async () => ({ data: [makeSession("s1", status)] }),
      status: async () => ({ data: { s1: { type: status } } }),
      prompt: async (opts) => {
        promptCalls.push(opts)
        return {}
      },
      promptAsync: async (opts) => {
        promptAsyncCalls.push(opts)
        return {}
      },
    },
    app: {
      log: async () => {},
    },
  }
  return { client, promptCalls, promptAsyncCalls }
}

const runPlugin = async (client: MockClient) => {
  const busPath = join(mkdtempSync(join(tmpdir(), "mismcp-bus-")), "bus.db")
  const prevId = process.env.AGENT_ID
  const prevBus = process.env.BUS_PATH
  process.env.AGENT_ID = "tester"
  process.env.BUS_PATH = busPath

  // seed two peers so the roster is non-empty
  const store = openStore(busPath)
  store.register("analyst")
  store.register("developer")

  const hooks = await Mismcp({ client, directory } as never)
  await sleep(50)

  // poll ticks every 3s; hook.dispose stops it
  await hooks.dispose?.()

  if (prevId === undefined) delete process.env.AGENT_ID
  else process.env.AGENT_ID = prevId
  if (prevBus === undefined) delete process.env.BUS_PATH
  else process.env.BUS_PATH = prevBus
  rmSync(busPath, { force: true })

  return hooks
}

describe("roster injection", () => {
  it("injects roster via promptAsync when the session is idle", async () => {
    const { client, promptCalls, promptAsyncCalls } = makeClient("idle")
    await runPlugin(client)

    assert.equal(promptCalls.length, 0, "must not use sync prompt for roster")
    assert.ok(promptAsyncCalls.length >= 1, "roster should be injected")
    const call = promptAsyncCalls[0]
    assert.equal(call.body.noReply, true)
    const text = call.body.parts.map((p) => p.text).join("\n")
    assert.match(text, /analyst/)
    assert.match(text, /developer/)
  })

  it("injects roster via promptAsync even when the session is busy", async () => {
    const { client, promptCalls, promptAsyncCalls } = makeClient("busy")
    await runPlugin(client)

    assert.equal(promptCalls.length, 0, "must not fall back to sync prompt")
    assert.ok(promptAsyncCalls.length >= 1, "roster must be injected into a busy session")
    const text = promptAsyncCalls[0].body.parts.map((p) => p.text).join("\n")
    assert.match(text, /analyst/)
    assert.match(text, /developer/)
  })
})