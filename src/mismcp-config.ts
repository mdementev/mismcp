import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface MismcpConfig {
  nameTemplate: string
  busPath: string
}

const DEFAULT_TEMPLATE = "{dir}-agent"

export const defaultBusPath = (): string => join(homedir(), ".mismcp", "bus.db")

export const defaultConfig = (): MismcpConfig => ({
  nameTemplate: DEFAULT_TEMPLATE,
  busPath: defaultBusPath(),
})

// Config lives next to opencode's own config, one file per plugin. Override the
// directory with MISMCP_CONFIG_DIR (used by tests, and handy for throwaway runs).
export const configDir = (env: Record<string, string | undefined> = process.env): string => {
  const override = (env.MISMCP_CONFIG_DIR ?? "").trim()
  return override || join(homedir(), ".config", "opencode")
}

export const configFiles = (dir: string): string[] => [
  join(dir, "mismcp.jsonc"),
  join(dir, "mismcp.json"),
]

export const expandPath = (path: string): string => {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

// Written verbatim on first run so the user has something to edit.
export const CONFIG_TEMPLATE = `{
  // mismcp — opencode multi-agent bus.
  // Created automatically on first run; edit and restart opencode to apply.
  // Docs: https://github.com/mdementev/mismcp

  // Name for this agent. Tokens: {dir} {worktree} {projectId} {host} {user} {pid}.
  // A 6-char base36 suffix is always appended. For a stable, suffix-free name,
  // set the AGENT_ID env var instead — it wins over this file.
  "nameTemplate": "${DEFAULT_TEMPLATE}",

  // Shared SQLite queue. Default: ~/.mismcp/bus.db. Override with the BUS_PATH env var.
  "busPath": "~/.mismcp/bus.db"
}
`

/**
 * Strips comments from JSONC while respecting string boundaries (handles // and
 * /* comments, URLs in strings, escaped quotes) and removes trailing commas.
 */
export const stripJsoncComments = (content: string): string => {
  let result = ""
  let i = 0
  let inString = false
  let inSingleLineComment = false
  let inMultiLineComment = false
  while (i < content.length) {
    const char = content[i]
    const nextChar = content[i + 1]
    if (!inSingleLineComment && !inMultiLineComment && char === '"') {
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && content[j] === "\\") {
        backslashCount++
        j--
      }
      if (backslashCount % 2 === 0) inString = !inString
      result += char
      i++
      continue
    }
    if (inString) {
      result += char
      i++
      continue
    }
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true
        i += 2
        continue
      }
      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true
        i += 2
        continue
      }
    }
    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false
        result += char
      }
      i++
      continue
    }
    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false
        i += 2
        continue
      }
      if (char === "\n") result += char
      i++
      continue
    }
    result += char
    i++
  }
  return result.replace(/,\s*([}\]])/g, "$1")
}

/**
 * Creates the global config file from CONFIG_TEMPLATE when it does not exist yet.
 * Best-effort: a read-only filesystem must never stop the plugin from loading.
 * Returns the path it uses (whether or not it had to create it).
 */
export const ensureConfigExists = (
  dir: string = configDir(),
  env: Record<string, string | undefined> = process.env,
): string => {
  const path = configFiles(dir)[0]
  if (existsSync(path)) return path
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, CONFIG_TEMPLATE, "utf-8")
  } catch {
    // ignore — fall back to defaults
  }
  return path
}

const readConfigFile = (path: string): Partial<MismcpConfig> | null => {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(stripJsoncComments(readFileSync(path, "utf-8"))) as unknown
    return raw && typeof raw === "object" ? (raw as Partial<MismcpConfig>) : null
  } catch {
    return null
  }
}

// First existing file wins within a location (jsonc preferred over json).
const loadFromPaths = (paths: string[]): Partial<MismcpConfig> => {
  for (const path of paths) {
    const config = readConfigFile(path)
    if (config) return config
  }
  return {}
}

/**
 * Merges the global config (~/.config/opencode/mismcp.jsonc) with an optional
 * project config (<directory>/.opencode/mismcp.jsonc); the project wins.
 * Missing/invalid values fall back to defaults.
 */
export const loadConfig = (
  directory?: string,
  env: Record<string, string | undefined> = process.env,
): MismcpConfig => {
  const base = defaultConfig()
  const globalConfig = loadFromPaths(configFiles(configDir(env)))
  const projectConfig = directory ? loadFromPaths(configFiles(join(directory, ".opencode"))) : {}
  const raw: Partial<MismcpConfig> = { ...globalConfig, ...projectConfig }

  const nameTemplate =
    typeof raw.nameTemplate === "string" && raw.nameTemplate.trim()
      ? raw.nameTemplate.trim()
      : base.nameTemplate
  const busPath =
    typeof raw.busPath === "string" && raw.busPath.trim()
      ? expandPath(raw.busPath.trim())
      : base.busPath

  return { nameTemplate, busPath }
}
