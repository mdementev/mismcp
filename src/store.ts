import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

// The single store must run in two different runtimes:
//   - Node (the MCP server, `node dist/mcp-server.js`): built-in `node:sqlite` (`DatabaseSync`).
//   - Bun (the plugin, on opencode's embedded Bun ≤1.3.x): `bun:sqlite` (`Database`) —
//     that Bun cannot resolve `node:sqlite` yet.
// Load the right module with a runtime check instead of a static import, so neither
// runtime tries to resolve the module it does not have.
const isBun = typeof (process.versions as { bun?: string }).bun !== "undefined"
const rawRequire = createRequire(import.meta.url)
const sqlite = isBun ? rawRequire("bun:sqlite") : rawRequire("node:sqlite")
const Database = isBun ? sqlite.Database : sqlite.DatabaseSync

type Db = {
  exec(sql: string): void
  prepare?(sql: string): Statement
  query?(sql: string): Statement
}
type Statement = {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}
// bun:sqlite calls it `query`, node:sqlite calls it `prepare`.
const prepare = (db: Db, sql: string): Statement => {
  const stmt = db.prepare ? db.prepare(sql) : db.query!(sql)
  return stmt as Statement
}

export type MessageType = "question" | "answer"

export interface Message {
  id: string
  from: string
  recipient: string
  type: MessageType
  content: string
  created_at: number
  acked: number
}

export interface AgentRow {
  agent_id: string
  last_seen: number
}

const DEFAULT_TTL_MS = 30_000

export interface Store {
  send(input: { from: string; recipient: string; type: MessageType; content: string }): Message
  inbox(agentId: string): Message[]
  ack(id: string): void
  register(agentId: string): void
  agents(ttlMs?: number): AgentRow[]
}

export function openStore(dbPath: string): Store {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db: Db = new Database(dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA synchronous = NORMAL")

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      "from" TEXT NOT NULL,
      recipient TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('question', 'answer')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      acked INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      last_seen INTEGER NOT NULL
    )
  `)
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages (recipient, acked, created_at)")

  const sendStmt = prepare(
    db,
    `INSERT INTO messages (id, \`from\`, recipient, type, content, created_at, acked) VALUES (?, ?, ?, ?, ?, ?, 0)`,
  )
  const inboxStmt = prepare(
    db,
    "SELECT * FROM messages WHERE recipient = ? AND acked = 0 ORDER BY created_at ASC",
  )
  const ackStmt = prepare(db, "UPDATE messages SET acked = 1 WHERE id = ?")
  const registerStmt = prepare(
    db,
    `INSERT INTO agents (agent_id, last_seen) VALUES (?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET last_seen = excluded.last_seen`,
  )
  const agentsStmt = prepare(
    db,
    "SELECT * FROM agents WHERE last_seen >= ? ORDER BY agent_id ASC",
  )

  return {
    send({ from, recipient, type, content }) {
      const msg: Message = {
        id: crypto.randomUUID(),
        from,
        recipient,
        type,
        content,
        created_at: Date.now(),
        acked: 0,
      }
      sendStmt.run(msg.id, msg.from, msg.recipient, msg.type, msg.content, msg.created_at)
      return msg
    },

    inbox(agentId) {
      return inboxStmt.all(agentId) as unknown as Message[]
    },

    ack(id) {
      ackStmt.run(id)
    },

    register(agentId) {
      registerStmt.run(agentId, Date.now())
    },

    agents(ttlMs = DEFAULT_TTL_MS) {
      return agentsStmt.all(Date.now() - ttlMs) as unknown as AgentRow[]
    },
  }
}
