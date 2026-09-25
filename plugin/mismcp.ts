import { tool, type Plugin } from "@opencode-ai/plugin"
import { openStore } from "../src/mismcp-store.ts"
import type { Message } from "../src/mismcp-store.ts"
import { deriveAgentId } from "../src/mismcp-agent-id.ts"
import { ensureConfigExists, loadConfig } from "../src/mismcp-config.ts"

const ROSTER_PREFIX = "Available agents to ask via mismcp_bus_send"
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

type DataResult<T> = { data: T | undefined }

const unwrap = <T>(res: DataResult<T> | T): T => {
  const obj = res as { data?: T }
  if (obj && typeof obj === "object" && "data" in obj) {
    if (obj.data === undefined) throw new Error("empty response from opencode API")
    return obj.data
  }
  return res as T
}

export const Mismcp: Plugin = async ({ client, directory, worktree, project }, options) => {
  const configPath = ensureConfigExists()
  const config = loadConfig(directory)
  const busPath = (process.env.BUS_PATH ?? "").trim() || config.busPath
  const store = openStore(busPath)

  const { id: agentId, source: agentIdSource } = deriveAgentId({
    env: process.env,
    options,
    fileTemplate: config.nameTemplate,
    ctx: { directory, worktree, projectId: project?.id ?? "" },
    isTaken: (id) => store.agents().some((a) => a.agent_id === id),
  })

  const busSendTool = tool({
    description:
      "Send a message to another opencode agent over the shared bus. " +
      "CALL THIS TOOL DIRECTLY — do not research the bus, AGENT_ID, recipients, or source files; " +
      "your context already contains a line listing the online agents: " +
      '"Available agents to ask via mismcp_bus_send: <id1, id2, ...>". ' +
      "Copy a recipient from that line verbatim. " +
      'Use type "question" to ask another agent something (they reply asynchronously via this same tool). ' +
      'Use type "answer" to reply to a question you received ("Question from X: ..."). ' +
      'Example: mismcp_bus_send(recipient: "tester", type: "question", content: "How are you?"). ' +
      "If you don't know a valid recipient ID, say so instead of guessing.",
    args: {
      recipient: tool.schema
        .string()
        .min(1)
        .describe("AGENT_ID from the 'Available agents to ask via mismcp_bus_send:' line in your context, e.g. \"tester\""),
      content: tool.schema
        .string()
        .min(1)
        .describe('message body; for type "answer", put your full structured reply here'),
      type: tool.schema
        .enum(["question", "answer"])
        .describe('"question" = ask another agent; "answer" = reply to a received question'),
    },
    async execute({ recipient, content, type }) {
      if (recipient === agentId)
        return `refusing to send a message to yourself ("${agentId}") — pick another agent from the roster`
      const msg = store.send({ from: agentId, recipient, type, content })
      return JSON.stringify({ id: msg.id, from: msg.from, created_at: msg.created_at })
    },
  })

  await client.app.log({
    body: {
      service: "mismcp",
      level: "info",
      message: `agent bus online as "${agentId}"`,
      extra: { busPath, source: agentIdSource, config: configPath },
    },
  })

  store.register(agentId)

  const peers = () =>
    store
      .agents()
      .filter((a) => a.agent_id !== agentId)
      .map((a) => a.agent_id)

  const rosterLine = () => {
    const roster = peers().join(", ")
    return roster
      ? `${ROSTER_PREFIX} (copy an ID from this list): ${roster}`
      : `${ROSTER_PREFIX}: no other agents are online right now.`
  }

  let rosterCache = ""
  const injectedSessions = new Set<string>()
  const ownedSessions = new Set<string>()

  const injectRoster = async () => {
    const line = rosterLine()
    if (line !== rosterCache) {
      rosterCache = line
      injectedSessions.clear()
    }

    const session = await findOwnedSession(true)
    if (!session) return
    if (injectedSessions.has(session.id)) return

    await client.session.promptAsync({
      path: { id: session.id },
      body: { noReply: true, parts: [{ type: "text", text: line, ignored: true }] },
    })
    injectedSessions.add(session.id)
  }

  // A session belongs to this instance only if it was created here (the
  // `session.created` event) or is running here (SessionStatus is per-process).
  // opencode stores sessions in a shared, directory-keyed DB, so other agents'
  // sessions share the same `directory` and must never receive our messages.
  const findOwnedSession = async (freeOnly: boolean) => {
    const sessions = unwrap(await client.session.list()).filter(
      (s) => s.directory === directory && !s.parentID,
    )
    if (sessions.length === 0) return null

    const statuses = unwrap(await client.session.status({ query: { directory } }))
    const owned = sessions.filter((s) => ownedSessions.has(s.id) || statuses[s.id] !== undefined)
    const candidates = freeOnly ? owned.filter((s) => statuses[s.id]?.type !== "busy") : owned
    if (candidates.length === 0) return null

    return candidates.sort((a, b) => b.time.updated - a.time.updated)[0]
  }

  const pushMessage = async (msg: Message): Promise<void> => {
    const session = await findOwnedSession(false)
    if (!session) {
      await client.app.log({
        body: {
          service: "mismcp",
          level: "warn",
          message: `no owned session in this instance; will retry message from ${msg.from}`,
        },
      })
      return
    }

    const text =
      msg.type === "question"
        ? `Question from ${msg.from}:\n${msg.content}\n\n` +
          `Research if needed, then compose a structured answer and send it to ${msg.from} via ` +
          `mismcp_bus_send(recipient: "${msg.from}", type: "answer", content: <your full answer>). ` +
          `Put the final answer in the tool argument.`
        : `Answer from ${msg.from}:\n${msg.content}`

    await client.session.promptAsync({
      path: { id: session.id },
      body: { parts: [{ type: "text", text }] },
    })
    store.ack(msg.id)
  }

  let lastPrune = 0
  const poll = async () => {
    store.register(agentId)

    const now = Date.now()
    if (now - lastPrune >= PRUNE_INTERVAL_MS) {
      lastPrune = now
      try {
        store.prune()
      } catch (err) {
        await client.app.log({
          body: { service: "mismcp", level: "error", message: `prune: ${String(err)}` },
        })
      }
    }

    try {
      await injectRoster()
    } catch (err) {
      await client.app.log({
        body: { service: "mismcp", level: "error", message: `roster: ${String(err)}` },
      })
    }

    for (const msg of store.inbox(agentId)) {
      try {
        await pushMessage(msg)
      } catch (err) {
        await client.app.log({
          body: { service: "mismcp", level: "error", message: `push: ${String(err)}` },
        })
      }
    }
  }

  const timer = setInterval(poll, 3000)
  poll()

  return {
    tool: { mismcp_bus_send: busSendTool },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      // This hook only runs for sessions handled by this instance.
      ownedSessions.add(input.sessionID)
      const line = rosterLine()
      const idx = output.system.findIndex((s) => s.includes(ROSTER_PREFIX))
      if (idx >= 0) output.system[idx] = line
      else output.system.push(line)
    },
    dispose: async () => {
      clearInterval(timer)
    },
    event: async ({ event }) => {
      if (event.type === "session.created") {
        ownedSessions.add(event.properties.info.id)
        await injectRoster()
      } else if (event.type === "session.deleted") {
        ownedSessions.delete(event.properties.info.id)
        injectedSessions.delete(event.properties.info.id)
      } else if (event.type === "session.compacted") {
        injectedSessions.delete(event.properties.sessionID)
        await injectRoster()
      }
    },
  }
}