import { basename } from "node:path"
import { hostname, userInfo } from "node:os"

export interface AgentIdContext {
  directory: string
  worktree: string
  projectId: string
}

export interface DeriveAgentIdInput {
  env: Record<string, string | undefined>
  options?: Record<string, unknown>
  fileTemplate?: string
  ctx: AgentIdContext
  isTaken?: (id: string) => boolean
}

export type AgentIdSource =
  | "agent_id"
  | "env_template"
  | "file_config"
  | "config_template"
  | "default"

export interface DerivedAgentId {
  id: string
  source: AgentIdSource
}

const DEFAULT_TEMPLATE = "{dir}"
const SUFFIX_LENGTH = 6
const MAX_PREFIX = 40
const COLLISION_RETRIES = 5

export const normalize = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/[-_]{2,}/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")

const safe = (fn: () => string): string => {
  try {
    return fn()
  } catch {
    return ""
  }
}

export const renderTemplate = (template: string, ctx: AgentIdContext): string => {
  const values: Record<string, string> = {
    dir: basename(ctx.directory ?? ""),
    worktree: basename(ctx.worktree ?? ""),
    projectid: ctx.projectId ?? "",
    host: safe(hostname),
    user: safe(() => userInfo().username),
    pid: String(process.pid),
  }
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (_match, name: string) => {
    const key = name.toLowerCase()
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : ""
  })
}

export const randomSuffix = (length = SUFFIX_LENGTH): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n.toString(36).slice(0, length).padStart(length, "0")
}

const prefixFromTemplate = (template: string, ctx: AgentIdContext): string => {
  const rendered = normalize(renderTemplate(template, ctx))
  const capped = rendered.slice(0, MAX_PREFIX).replace(/[-_]+$/, "")
  return capped || "agent"
}

export const deriveAgentId = ({ env, options, fileTemplate, ctx, isTaken }: DeriveAgentIdInput): DerivedAgentId => {
  const explicit = (env.AGENT_ID ?? "").trim()
  if (explicit) return { id: explicit, source: "agent_id" }

  const envTemplate = (env.MISMCP_NAME_TEMPLATE ?? "").trim()
  const fromFile = (fileTemplate ?? "").trim()
  const configTemplate = typeof options?.nameTemplate === "string" ? options.nameTemplate.trim() : ""
  const template = envTemplate || fromFile || configTemplate || DEFAULT_TEMPLATE
  const source: AgentIdSource = envTemplate
    ? "env_template"
    : fromFile
      ? "file_config"
      : configTemplate
        ? "config_template"
        : "default"

  const prefix = prefixFromTemplate(template, ctx)
  for (let i = 0; i < COLLISION_RETRIES; i++) {
    const candidate = `${prefix}-${randomSuffix()}`
    if (!isTaken?.(candidate)) return { id: candidate, source }
  }
  return { id: `${prefix}-${randomSuffix(8)}`, source }
}
