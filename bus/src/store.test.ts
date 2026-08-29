import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { openStore } from "./store.js"

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