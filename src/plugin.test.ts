import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Mismcp } from "../plugin/mismcp.ts"
import { openStore } from "./mismcp-store.ts"

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

type RunOptions = {
  agentId?: string | null
  template?: string
  options?: Record<string, unknown>
  fileConfig?: string
}

const runPlugin = async (client: MockClient, opts: RunOptions = {}) => {
  const busPath = join(mkdtempSync(join(tmpdir(), "mismcp-bus-")), "bus.db")
  const configDir = mkdtempSync(join(tmpdir(), "mismcp-cfg-"))
  if (opts.fileConfig !== undefined) {
    writeFileSync(join(configDir, "mismcp.jsonc"), opts.fileConfig)
  }
  const prevId = process.env.AGENT_ID
  const prevBus = process.env.BUS_PATH
  const prevTemplate = process.env.MISMCP_NAME_TEMPLATE
  const prevConfigDir = process.env.MISMCP_CONFIG_DIR
  if (opts.agentId === null) delete process.env.AGENT_ID
  else process.env.AGENT_ID = opts.agentId ?? "tester"
  process.env.BUS_PATH = busPath
  process.env.MISMCP_CONFIG_DIR = configDir
  if (opts.template === undefined) delete process.env.MISMCP_NAME_TEMPLATE
  else process.env.MISMCP_NAME_TEMPLATE = opts.template

  // seed two peers so the roster is non-empty
  const store = openStore(busPath)
  store.register("analyst")
  store.register("developer")

  const hooks = await Mismcp({ client, directory } as never, opts.options)
  await sleep(50)

  const agents = store.agents().map((a) => a.agent_id)

  // poll ticks every 3s; hook.dispose stops it
  await hooks.dispose?.()

  if (prevId === undefined) delete process.env.AGENT_ID
  else process.env.AGENT_ID = prevId
  if (prevBus === undefined) delete process.env.BUS_PATH
  else process.env.BUS_PATH = prevBus
  if (prevTemplate === undefined) delete process.env.MISMCP_NAME_TEMPLATE
  else process.env.MISMCP_NAME_TEMPLATE = prevTemplate
  if (prevConfigDir === undefined) delete process.env.MISMCP_CONFIG_DIR
  else process.env.MISMCP_CONFIG_DIR = prevConfigDir
  rmSync(busPath, { force: true })
  rmSync(configDir, { recursive: true, force: true })

  return { hooks, agents }
}

describe("system prompt roster", () => {
  it("injects a single roster line for an owned session", async () => {
    const { client } = makeClient("idle")
    const { hooks } = await runPlugin(client)

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "s1", model: {} as never }, output)

    assert.equal(output.system.length, 1, "exactly one roster entry")
    assert.match(output.system[0], /analyst/)
    assert.match(output.system[0], /developer/)
    assert.doesNotMatch(output.system[0], /tester/)
  })

  it("does not duplicate the roster when the hook fires twice", async () => {
    const { client } = makeClient("idle")
    const { hooks } = await runPlugin(client)

    const output = { system: [] as string[] }
    const hook = hooks["experimental.chat.system.transform"]!
    await hook({ sessionID: "s1", model: {} as never }, output)
    await hook({ sessionID: "s1", model: {} as never }, output)

    assert.equal(output.system.length, 1, "roster must stay a single entry")
  })

  it("skips requests without a session id", async () => {
    const { client } = makeClient("idle")
    const { hooks } = await runPlugin(client)

    const noSession = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ model: {} as never }, noSession)
    assert.equal(noSession.system.length, 0)
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

describe("session ownership", () => {
  it("never delivers into another agent's session in the same directory", async () => {
    const busPath = join(mkdtempSync(join(tmpdir(), "mismcp-bus-")), "bus.db")
    const prevId = process.env.AGENT_ID
    const prevBus = process.env.BUS_PATH
    process.env.AGENT_ID = "tester"
    process.env.BUS_PATH = busPath

    const promptAsyncCalls: PromptCall[] = []
    // The foreign session is newer, so naive "most recently updated" picks it.
    const foreign = { ...makeSession("s_foreign"), time: { created: 1, updated: 100 } }
    const own = { ...makeSession("s_own"), time: { created: 1, updated: 1 } }
    const client = {
      session: {
        list: async () => ({ data: [foreign, own] }),
        status: async () => ({ data: { s_own: { type: "idle" as const } } }),
        promptAsync: async (opts: PromptCall) => {
          promptAsyncCalls.push(opts)
          return {}
        },
      },
      app: { log: async () => {} },
    }

    const store = openStore(busPath)
    store.send({ from: "analyst", recipient: "tester", type: "question", content: "ping" })

    const hooks = await Mismcp({ client, directory } as never)
    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "s_own" } } },
    } as never)
    await sleep(50)
    await hooks.dispose?.()

    const delivered = promptAsyncCalls.filter((c) =>
      c.body.parts.some((p) => p.text.includes("Question from analyst")),
    )
    assert.equal(delivered.length, 1, "exactly one delivery")
    assert.equal(delivered[0].path.id, "s_own", "must target the owned session")
    assert.ok(
      promptAsyncCalls.every((c) => c.path.id !== "s_foreign"),
      "must never touch the foreign session",
    )

    if (prevId === undefined) delete process.env.AGENT_ID
    else process.env.AGENT_ID = prevId
    if (prevBus === undefined) delete process.env.BUS_PATH
    else process.env.BUS_PATH = prevBus
    rmSync(busPath, { force: true })
  })
})

describe("automatic agent naming", () => {
  const ownId = (agents: string[]) =>
    agents.find((a) => /^mismcp-plugin-test-agent-[a-z0-9]{6}$/.test(a))

  it("registers an auto-derived id from the default config template", async () => {
    const { client } = makeClient("idle")
    const { hooks, agents } = await runPlugin(client, { agentId: null })

    const own = ownId(agents)
    assert.ok(own, `expected an auto-derived id, got: ${agents.join(", ")}`)

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "s1", model: {} as never }, output)
    assert.match(output.system[0], /analyst/)
    assert.doesNotMatch(output.system[0], new RegExp(own!), "own id must not appear in the roster")
  })

  it("honors the MISMCP_NAME_TEMPLATE env var", async () => {
    const { client } = makeClient("idle")
    const { agents } = await runPlugin(client, { agentId: null, template: "custom" })

    assert.ok(agents.some((a) => /^custom-[a-z0-9]{6}$/.test(a)), agents.join(", "))
  })

  it("honors the nameTemplate from the config file", async () => {
    const { client } = makeClient("idle")
    const { agents } = await runPlugin(client, {
      agentId: null,
      fileConfig: `{ "nameTemplate": "filecfg" }`,
    })

    assert.ok(agents.some((a) => /^filecfg-[a-z0-9]{6}$/.test(a)), agents.join(", "))
  })

  it("prefers the config file over the plugin option", async () => {
    const { client } = makeClient("idle")
    const { agents } = await runPlugin(client, {
      agentId: null,
      options: { nameTemplate: "optcfg" },
      fileConfig: `{ "nameTemplate": "filecfg" }`,
    })

    assert.ok(agents.some((a) => /^filecfg-[a-z0-9]{6}$/.test(a)), agents.join(", "))
    assert.ok(!agents.some((a) => /^optcfg-/.test(a)), "plugin option must not win")
  })
})
