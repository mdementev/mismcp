import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { openStore } from "./store"

describe("store", () => {
  const store = () => openStore(":memory:")

  test("send → inbox roundtrip for recipient", () => {
    const s = store()
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "how?" })

    const inbox = s.inbox("sut_expert")
    expect(inbox).toHaveLength(1)
    expect(inbox[0].from).toBe("tester")
    expect(inbox[0].recipient).toBe("sut_expert")
    expect(inbox[0].type).toBe("question")
    expect(inbox[0].content).toBe("how?")
    expect(inbox[0].acked).toBe(0)

    expect(s.inbox("tester")).toHaveLength(0)
  })

  test("ack removes message from inbox", () => {
    const s = store()
    const msg = s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "how?" })
    s.ack(msg.id)

    expect(s.inbox("sut_expert")).toHaveLength(0)
  })

  test("inbox preserves send order", () => {
    const s = store()
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "first" })
    s.send({ from: "tester", recipient: "sut_expert", type: "question", content: "second" })

    const inbox = s.inbox("sut_expert")
    expect(inbox.map((m) => m.content)).toEqual(["first", "second"])
  })

  test("register + agents with ttl", async () => {
    const s = store()
    s.register("tester")
    s.register("sut_expert")

    expect(s.agents().map((a) => a.agent_id)).toEqual(["sut_expert", "tester"])
    // stale entry older than ttl is excluded
    await Bun.sleep(5)
    expect(s.agents(0)).toEqual([])
  })

  test("register refreshes last_seen (heartbeat)", async () => {
    const s = store()
    s.register("tester")
    await Bun.sleep(5)
    expect(s.agents(0)).toHaveLength(0)

    s.register("tester")
    expect(s.agents(0)).toHaveLength(1)
  })

  test("concurrent writers do not lose messages", () => {
    const s = store()
    const senders = Array.from({ length: 20 }, (_, i) => i)
    senders.forEach((i) => {
      s.send({ from: `a${i}`, recipient: "sut_expert", type: "answer", content: `c${i}` })
    })

    expect(s.inbox("sut_expert")).toHaveLength(20)
  })

  test("file-backed store persists", () => {
    const path = `${import.meta.dir}/.tmp-test.db`
    rmSync(path, { force: true })
    const a = openStore(path)
    a.send({ from: "tester", recipient: "sut_expert", type: "question", content: "persisted?" })

    const b = openStore(path)
    expect(b.inbox("sut_expert")).toHaveLength(1)
    rmSync(path, { force: true })
  })
})
