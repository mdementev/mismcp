import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Mismcp } from "../plugin/mismcp.ts"
import { openStore } from "./store.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type PromptCall = {
  path: { id: string }
  body: { noReply?: boolean; parts: { type: string; text: string; ignored?: boolean }[] }
}

type MockClient = {
  session: {
    list: () => Promise<{ data: unknown[] }>
    status: () => Promise<{ data: Record<string, { type: "busy" | "idle" | "retry" }> }>
    promptAsync: (opts: PromptCall) => Promise<unknown>
  }
  app: {
    log: () => Promise<void>
  }
}

const directory = join(tmpdir(), "mismcp-plugin-test")

const makeSession = (id: string) => ({
  id,
  projectID: "proj",
  directory,
  title: id,
  version: "1",
  time: { created: 1, updated: 1 },
})

const makeClient = (status: "busy" | "idle") => {
  const promptAsyncCalls: PromptCall[] = []
  const client: MockClient = {
    session: {
      list: async () => ({ data: [makeSession("s1")] }),
      status: async () => ({ data: { s1: { type: status } } }),
      promptAsync: async (opts) => {
        promptAsyncCalls.push(opts)
        return {}
      },
    },
    app: {
      log: async () => {},
    },
  }
  return { client, promptAsyncCalls }
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

describe("system prompt roster", () => {
  it("injects a single roster line for an owned session", async () => {
    const { client } = makeClient("idle")
    const hooks = await runPlugin(client)

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "s1", model: {} as never }, output)

    assert.equal(output.system.length, 1, "exactly one roster entry")
    assert.match(output.system[0], /analyst/)
    assert.match(output.system[0], /developer/)
    assert.doesNotMatch(output.system[0], /tester/)
  })

  it("does not duplicate the roster when the hook fires twice", async () => {
    const { client } = makeClient("idle")
    const hooks = await runPlugin(client)

    const output = { system: [] as string[] }
    const hook = hooks["experimental.chat.system.transform"]!
    await hook({ sessionID: "s1", model: {} as never }, output)
    await hook({ sessionID: "s1", model: {} as never }, output)

    assert.equal(output.system.length, 1, "roster must stay a single entry")
  })

  it("skips requests without a session id or for a foreign session", async () => {
    const { client } = makeClient("idle")
    const hooks = await runPlugin(client)

    const noSession = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ model: {} as never }, noSession)
    assert.equal(noSession.system.length, 0)

    const foreign = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "other", model: {} as never }, foreign)
    assert.equal(foreign.system.length, 0)
  })
})

describe("roster notice", () => {
  it("injects a model-invisible notice into an idle session", async () => {
    const { client, promptAsyncCalls } = makeClient("idle")
    await runPlugin(client)

    assert.ok(promptAsyncCalls.length >= 1, "notice should be injected")
    const call = promptAsyncCalls[0]
    assert.equal(call.body.noReply, true)
    assert.equal(call.body.parts[0].ignored, true, "notice must not enter model context")
    assert.match(call.body.parts.map((p) => p.text).join("\n"), /analyst/)
  })

  it("does not inject a notice into a busy session", async () => {
    const { client, promptAsyncCalls } = makeClient("busy")
    await runPlugin(client)

    assert.equal(promptAsyncCalls.length, 0, "must not inject during an active loop")
  })
})
