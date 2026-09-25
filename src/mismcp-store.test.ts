import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { openStore } from "./mismcp-store.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("store", () => {
  const store = () => openStore(":memory:")

  it("send → inbox roundtrip for recipient", () => {
    const s = store()
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "how?" })

    const inbox = s.inbox("sut_expert")
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].from, "tester")
    assert.equal(inbox[0].recipient, "sut_expert")
    assert.equal(inbox[0].type, "question")
    assert.equal(inbox[0].content, "how?")
    assert.equal(inbox[0].acked, 0)

    assert.equal(s.inbox("tester").length, 0)
  })

  it("ack removes message from inbox", () => {
    const s = store()
    const msg = s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "how?" })
    s.ack(msg.id)

    assert.equal(s.inbox("sut_expert").length, 0)
  })

  it("inbox preserves send order", () => {
    const s = store()
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "first" })
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "second" })

    const inbox = s.inbox("sut_expert")
    assert.deepEqual(inbox.map((m) => m.content), ["first", "second"])
  })

  it("register + agents with ttl", async () => {
    const s = store()
    s.register("tester")
    s.register("sut_expert")

    assert.deepEqual(s.agents().map((a) => a.agent_id), ["sut_expert", "tester"])
    // stale entry older than ttl is excluded
    await sleep(5)
    assert.deepEqual(s.agents(0), [])
  })

  it("register refreshes last_seen (heartbeat)", async () => {
    const s = store()
    s.register("tester")
    await sleep(5)
    assert.equal(s.agents(0).length, 0)

    s.register("tester")
    assert.equal(s.agents(0).length, 1)
  })

  it("concurrent writers do not lose messages", () => {
    const s = store()
    const senders = Array.from({ length: 20 }, (_, i) => i)
    senders.forEach((i) => {
      s.send({ from: `a${i}`, recipient: "sut_expert", type: "answer", content: `c${i}` })
    })

    assert.equal(s.inbox("sut_expert").length, 20)
  })

  it("4 agents register and see each other", () => {
    const s = store()
    s.register("agent_a")
    s.register("agent_b")
    s.register("agent_c")
    s.register("agent_d")

    const ids = s.agents().map((a) => a.agent_id).sort()
    assert.deepEqual(ids, ["agent_a", "agent_b", "agent_c", "agent_d"])
  })

  it("4 file-backed stores see each other's agents", () => {
    const path = `${import.meta.dirname}/.tmp-test-multi.db`
    rmSync(path, { force: true })

    const stores = Array.from({ length: 4 }, () => openStore(path))
    stores.forEach((s, i) => s.register(`agent_${i}`))

    const allAgents = stores[0].agents().map((a) => a.agent_id).sort()
    assert.deepEqual(allAgents, ["agent_0", "agent_1", "agent_2", "agent_3"])

    rmSync(path, { force: true })
  })

  it("4 agents send messages to each other (mesh)", () => {
    const s = store()
    s.register("a")
    s.register("b")
    s.register("c")
    s.register("d")

    s.send({ from: "a", recipient: "b", type: "question", content: "q1" })
    s.send({ from: "b", recipient: "c", type: "question", content: "q2" })
    s.send({ from: "c", recipient: "d", type: "question", content: "q3" })
    s.send({ from: "d", recipient: "a", type: "question", content: "q4" })

    assert.equal(s.inbox("a").length, 1)
    assert.equal(s.inbox("b").length, 1)
    assert.equal(s.inbox("c").length, 1)
    assert.equal(s.inbox("d").length, 1)
    assert.equal(s.inbox("a")[0].content, "q4")
    assert.equal(s.inbox("d")[0].content, "q3")
  })

  it("agent disappears from roster after TTL", async () => {
    const s = store()
    s.register("agent_a")
    s.register("agent_b")

    await sleep(5)
    s.register("agent_a")

    const ids = s.agents(0).map((a) => a.agent_id)
    assert.deepEqual(ids, ["agent_a"])
  })

  it("remove unregisters an agent", () => {
    const s = store()
    s.register("tester")
    s.register("sut_expert")
    s.remove("tester")

    assert.deepEqual(s.agents().map((a) => a.agent_id), ["sut_expert"])
  })

  it("prune deletes messages and agents older than the retention window", () => {
    const s = store()
    s.register("tester")
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "old" })

    // Default retention keeps recent data.
    assert.deepEqual(s.prune(), { messages: 0, agents: 0 })

    // A negative window treats everything as expired.
    assert.deepEqual(s.prune(-1), { messages: 1, agents: 1 })
    assert.equal(s.inbox("sut_expert").length, 0)
    assert.deepEqual(s.agents(), [])
  })

  it("file-backed store persists", () => {
    const path = `${import.meta.dirname}/.tmp-test.db`
    rmSync(path, { force: true })
    const a = openStore(path)
    a.send({ from: "tester", recipient: "sut_expert", type: "question", content: "persisted?" })

    const b = openStore(path)
    assert.equal(b.inbox("sut_expert").length, 1)
    rmSync(path, { force: true })
  })
})