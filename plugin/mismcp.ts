import { tool, type Plugin } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { openStore } from "../src/store"
import type { Message } from "../src/store"

type DataResult<T> = { data: T | undefined }

const unwrap = <T>(res: DataResult<T> | T): T => {
  const obj = res as { data?: T }
  if (obj && typeof obj === "object" && "data" in obj) {
    if (obj.data === undefined) throw new Error("empty response from opencode API")
    return obj.data
  }
  return res as T
}

export const Mismcp: Plugin = async ({ client, directory }) => {
  const agentId = (process.env.AGENT_ID ?? "").trim()
  const busPath = (process.env.BUS_PATH ?? "").trim() || join(homedir(), ".mismcp", "bus.db")
  const store = openStore(busPath)

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
      if (!agentId) return "AGENT_ID is not set — cannot send messages"
      if (recipient === agentId)
        return `refusing to send a message to yourself ("${agentId}") — pick another agent from the roster`
      const msg = store.send({ from: agentId, recipient, type, content })
      return JSON.stringify({ id: msg.id, from: msg.from, created_at: msg.created_at })
    },
  })

  if (!agentId) {
    await client.app.log({
      body: { service: "mismcp", level: "warn", message: "AGENT_ID is not set — agent bus disabled (tool still registered)" },
    })
    return { tool: { mismcp_bus_send: busSendTool } }
  }

  await client.app.log({
    body: { service: "mismcp", level: "info", message: `agent bus online as "${agentId}"`, extra: { busPath } },
  })

  store.register(agentId)

  let rosterCache = ""
  const injectedSessions = new Set<string>()
  const ownedSessions = new Set<string>()

  const injectRoster = async () => {
    const roster = store
      .agents()
      .filter((a) => a.agent_id !== agentId)
      .map((a) => a.agent_id)
      .join(", ")
    if (roster !== rosterCache) {
      rosterCache = roster
      injectedSessions.clear()
    }

    const session = await findOwnedSession(false)
    if (!session) return
    if (injectedSessions.has(session.id)) return

    const text = roster
      ? `Available agents to ask via mismcp_bus_send (copy an ID from this list): ${roster}`
      : "No other agents are online right now."
    await client.session.promptAsync({
      path: { id: session.id },
      body: { noReply: true, parts: [{ type: "text", text }] },
    })
    injectedSessions.add(session.id)
  }

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
    store.ack(msg.id)
    const session = await findOwnedSession(false)
    if (!session) {
      await client.app.log({
        body: {
          service: "mismcp",
          level: "warn",
          message: `no owned session in this instance; message from ${msg.from} dropped`,
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
  }

  const poll = async () => {
    store.register(agentId)
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