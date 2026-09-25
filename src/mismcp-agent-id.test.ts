import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { deriveAgentId, normalize, randomSuffix, renderTemplate } from "./mismcp-agent-id.ts"
import type { AgentIdContext } from "./mismcp-agent-id.ts"

const ctx = (directory = "/x/myproj"): AgentIdContext => ({
  directory,
  worktree: directory,
  projectId: "proj_123",
})

const env = (over: Record<string, string | undefined> = {}) => ({ ...over })

describe("normalize", () => {
  it("lowercases and replaces forbidden characters", () => {
    assert.equal(normalize("My Project"), "my_project")
    assert.equal(normalize("  hello  "), "hello")
    assert.equal(normalize("a--b"), "a_b")
    assert.equal(normalize("café"), "caf")
  })

  it("returns an empty string when nothing usable remains", () => {
    assert.equal(normalize("Проект"), "")
    assert.equal(normalize("---"), "")
    assert.equal(normalize(""), "")
  })
})

describe("renderTemplate", () => {
  it("substitutes known tokens", () => {
    assert.equal(renderTemplate("{dir}", ctx("/x/my proj")), "my proj")
    assert.equal(renderTemplate("agent-{dir}", ctx("/x/my proj")), "agent-my proj")
    assert.equal(renderTemplate("{projectId}", ctx()), "proj_123")
    assert.equal(renderTemplate("{pid}", ctx()), String(process.pid))
  })

  it("silently drops unknown tokens", () => {
    assert.equal(renderTemplate("a{unknown}b", ctx()), "ab")
    assert.equal(renderTemplate("{dir}-{nope}", ctx()), "myproj-")
  })
})

describe("randomSuffix", () => {
  it("produces base36 of the requested length", () => {
    assert.match(randomSuffix(), /^[a-z0-9]{6}$/)
    assert.match(randomSuffix(8), /^[a-z0-9]{8}$/)
  })

  it("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 5 }, () => randomSuffix()))
    assert.ok(seen.size > 1)
  })
})

describe("deriveAgentId", () => {
  it("prefers an explicit AGENT_ID and does not touch the roster", () => {
    const res = deriveAgentId({
      env: env({ AGENT_ID: "tester" }),
      ctx: ctx(),
      isTaken: () => {
        throw new Error("isTaken must not be called for an explicit AGENT_ID")
      },
    })
    assert.equal(res.id, "tester")
    assert.equal(res.source, "agent_id")
  })

  it("derives a name from the directory by default", () => {
    const res = deriveAgentId({ env: env(), ctx: ctx(), isTaken: () => false })
    assert.match(res.id, /^myproj-[a-z0-9]{6}$/)
    assert.equal(res.source, "default")
  })

  it("lets the env template win over the config template", () => {
    const res = deriveAgentId({
      env: env({ MISMCP_NAME_TEMPLATE: "envtpl" }),
      options: { nameTemplate: "opttpl" },
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(res.id, /^envtpl-[a-z0-9]{6}$/)
    assert.equal(res.source, "env_template")
  })

  it("uses the config template when the env template is absent or blank", () => {
    const fromOptions = deriveAgentId({
      env: env(),
      options: { nameTemplate: "opttpl" },
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(fromOptions.id, /^opttpl-[a-z0-9]{6}$/)
    assert.equal(fromOptions.source, "config_template")

    const blankEnv = deriveAgentId({
      env: env({ MISMCP_NAME_TEMPLATE: "   " }),
      options: { nameTemplate: "opttpl" },
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(blankEnv.id, /^opttpl-[a-z0-9]{6}$/)
  })

  it("prefers the file config over the plugin options", () => {
    const res = deriveAgentId({
      env: env(),
      options: { nameTemplate: "opttpl" },
      fileTemplate: "filetpl",
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(res.id, /^filetpl-[a-z0-9]{6}$/)
    assert.equal(res.source, "file_config")
  })

  it("lets the env template win over the file config", () => {
    const res = deriveAgentId({
      env: env({ MISMCP_NAME_TEMPLATE: "envtpl" }),
      fileTemplate: "filetpl",
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(res.id, /^envtpl-[a-z0-9]{6}$/)
    assert.equal(res.source, "env_template")
  })

  it("ignores a blank file template", () => {
    const res = deriveAgentId({
      env: env(),
      options: { nameTemplate: "opttpl" },
      fileTemplate: "   ",
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(res.id, /^opttpl-[a-z0-9]{6}$/)
    assert.equal(res.source, "config_template")
  })

  it("silently drops unknown tokens and falls back to 'agent' when empty", () => {
    const dropped = deriveAgentId({
      env: env({ MISMCP_NAME_TEMPLATE: "x{unknown}y" }),
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(dropped.id, /^xy-[a-z0-9]{6}$/)

    const fallback = deriveAgentId({
      env: env({ MISMCP_NAME_TEMPLATE: "!!!" }),
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(fallback.id, /^agent-[a-z0-9]{6}$/)
  })

  it("supports literal text and multiple tokens", () => {
    const res = deriveAgentId({
      env: env({ MISMCP_NAME_TEMPLATE: "agent-{dir}-{projectId}" }),
      ctx: ctx(),
      isTaken: () => false,
    })
    assert.match(res.id, /^agent-myproj-proj_123-[a-z0-9]{6}$/)
  })

  it("always appends a suffix, retrying on collisions", () => {
    const seen: string[] = []
    const res = deriveAgentId({
      env: env(),
      ctx: ctx(),
      isTaken: (id) => {
        seen.push(id)
        return seen.length <= 2
      },
    })
    assert.equal(seen.length, 3, "must retry until a free id is found")
    assert.match(res.id, /^myproj-[a-z0-9]{6}$/)
  })

  it("widens the suffix when every attempt collides", () => {
    const res = deriveAgentId({ env: env(), ctx: ctx(), isTaken: () => true })
    assert.match(res.id, /^myproj-[a-z0-9]{8}$/)
  })
})
