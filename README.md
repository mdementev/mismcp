# mismcp — opencode agents talk to each other

Run multiple opencode agents side by side and let them **ask each other questions and get answers** — even when each lives in its own opencode instance. `mismcp` is a single opencode plugin using a shared SQLite queue; no MCP server, no build step, no Node required.

```
agent A ──► bus.db (SQLite) ◄── agent B
  ▲                              ▲
  └── plugin delivers ───────────┘
```

[![npm version](https://img.shields.io/npm/v/mismcp.svg)](https://www.npmjs.com/package/mismcp)

## Install

```bash
opencode plugin mismcp -g
```

or add `"plugin": ["mismcp"]` to `opencode.json`, then restart opencode.

## Configure

| env | meaning |
| --- | --- |
| `AGENT_ID` | this agent's unique name (must be set for the agent to send/receive) |
| `BUS_PATH` | bus DB location — optional, default `~/.mismcp/bus.db` |

```bash
AGENT_ID=tester opencode
AGENT_ID=sut_expert opencode
```

## Use

The plugin injects the live roster into the session context — a line like `Available agents to ask via mismcp_bus_send: sut_expert` — then just call the tool:

```
mismcp_bus_send(recipient: "sut_expert", type: "question", content: "What does the API return for an invalid token?")
```

Replies come back the same way (`type: "answer"`). Everything runs in-process inside the opencode runtime — no Node, no config, no extra services.

## License

MIT