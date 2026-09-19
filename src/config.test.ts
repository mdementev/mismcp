import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONFIG_TEMPLATE,
  configDir,
  defaultBusPath,
  ensureConfigExists,
  expandPath,
  loadConfig,
  stripJsoncComments,
} from "./config.ts"

const tmp = () => mkdtempSync(join(tmpdir(), "mismcp-config-"))

describe("stripJsoncComments", () => {
  it("removes line and block comments and trailing commas", () => {
    const input = `{
      // line comment
      "a": 1, /* block */ "b": 2,
      "url": "https://example.com//x",
    }`
    const parsed = JSON.parse(stripJsoncComments(input)) as Record<string, unknown>
    assert.deepEqual(parsed, { a: 1, b: 2, url: "https://example.com//x" })
  })

  it("keeps escaped quotes and comment markers inside strings", () => {
    const input = `{ "s": "a \\" // not a comment /* nor this */" }`
    const parsed = JSON.parse(stripJsoncComments(input)) as Record<string, unknown>
    assert.equal(parsed.s, 'a " // not a comment /* nor this */')
  })
})

describe("expandPath", () => {
  it("expands ~ and ~/", () => {
    assert.equal(expandPath("~"), homedir())
    assert.equal(expandPath("~/.mismcp/bus.db"), join(homedir(), ".mismcp", "bus.db"))
    assert.equal(expandPath("/abs/path"), "/abs/path")
  })
})

describe("configDir", () => {
  it("honors MISMCP_CONFIG_DIR", () => {
    assert.equal(configDir({ MISMCP_CONFIG_DIR: "/tmp/x" }), "/tmp/x")
    assert.equal(configDir({}), join(homedir(), ".config", "opencode"))
  })
})

describe("ensureConfigExists", () => {
  it("creates the template on first run and leaves it untouched afterwards", (t) => {
    const dir = tmp()
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const path = join(dir, "mismcp.jsonc")

    const created = ensureConfigExists(dir, {})
    assert.equal(created, path)
    assert.ok(existsSync(path), "config file must be created")
    assert.equal(readFileSync(path, "utf-8"), CONFIG_TEMPLATE)

    writeFileSync(path, `{ "nameTemplate": "custom" }`)
    ensureConfigExists(dir, {})
    assert.equal(readFileSync(path, "utf-8"), `{ "nameTemplate": "custom" }`)
  })
})

describe("loadConfig", () => {
  it("falls back to defaults when nothing is configured", () => {
    const cfg = loadConfig(undefined, { MISMCP_CONFIG_DIR: tmp() })
    assert.equal(cfg.nameTemplate, "{dir}-agent")
    assert.equal(cfg.busPath, defaultBusPath())
  })

  it("reads the global config and expands ~", (t) => {
    const dir = tmp()
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(
      join(dir, "mismcp.jsonc"),
      `{ "nameTemplate": "agent-{dir}", "busPath": "~/custom/bus.db" }`,
    )
    const cfg = loadConfig(undefined, { MISMCP_CONFIG_DIR: dir })
    assert.equal(cfg.nameTemplate, "agent-{dir}")
    assert.equal(cfg.busPath, join(homedir(), "custom", "bus.db"))
  })

  it("lets the project config win over the global one", (t) => {
    const globalDir = tmp()
    const projectDir = tmp()
    t.after(() => {
      rmSync(globalDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    })
    writeFileSync(join(globalDir, "mismcp.jsonc"), `{ "nameTemplate": "global" }`)
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    writeFileSync(join(projectDir, ".opencode", "mismcp.json"), `{ "nameTemplate": "project" }`)

    const cfg = loadConfig(projectDir, { MISMCP_CONFIG_DIR: globalDir })
    assert.equal(cfg.nameTemplate, "project")
  })

  it("ignores a broken config file and uses defaults", (t) => {
    const dir = tmp()
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, "mismcp.jsonc"), "{ not valid json")
    const cfg = loadConfig(undefined, { MISMCP_CONFIG_DIR: dir })
    assert.equal(cfg.nameTemplate, "{dir}-agent")
    assert.equal(cfg.busPath, defaultBusPath())
  })
})
