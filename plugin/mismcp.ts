import type { Plugin } from "@opencode-ai/plugin"
import type { Session } from "@opencode-ai/sdk"
import { homedir } from "node:os"
import { join } from "node:path"
import { openStore } from "../bus/src/store"
import type { Message } from "../bus/src/store"

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
  if (!agentId) {
    await client.app.log({
      body: { service: "mismcp", level: "warn", message: "AGENT_ID is not set — agent bus disabled" },
    })
    return {}
  }

  const busPath = (process.env.BUS_PATH ?? "").trim() || join(homedir(), ".mismcp", "bus.db")
  const store = openStore(busPath)

  await client.app.log({
    body: {
      service: "mismcp",
      level: "info",
      message: `agent bus online as "${agentId}"`,
      extra: { busPath },
    },
  })

  store.register(agentId)

  let rosterCache = ""
  const injectedSessions = new Set<string>()

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

    const session = await findActiveSession()
    if (!session) return
    if (injectedSessions.has(session.id)) return

    const text = roster
      ? `Available agents to ask via mismcp_bus_send (copy an ID from this list): ${roster}`
      : "No other agents are online right now."
    await client.session.prompt({
      path: { id: session.id },
      body: { noReply: true, parts: [{ type: "text", text }] },
    })
    injectedSessions.add(session.id)
  }

  const findActiveSession = async (): Promise<Session | null> => {
    const sessions = unwrap(await client.session.list()).filter(
      (s) => s.directory === directory,
    )
    if (sessions.length === 0) return null

    const statuses = unwrap(await client.session.status({ query: { directory } }))
    const free = sessions.filter((s) => statuses[s.id]?.type !== "busy")
    if (free.length === 0) return null

    return free.sort((a, b) => b.time.updated - a.time.updated)[0]
  }

  const pushMessage = async (msg: Message): Promise<void> => {
    store.ack(msg.id)
    const session = await findActiveSession()
    if (!session) return

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
    dispose: async () => {
      clearInterval(timer)
    },
    event: async ({ event }) => {
      if (event.type === "session.created") {
        await injectRoster()
      } else if (event.type === "session.compacted") {
        injectedSessions.delete(event.properties.sessionID)
        await injectRoster()
      }
    },
  }
}
