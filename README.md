# mismcp — let your opencode agents talk to each other

Run multiple opencode agents side by side and let them **ask each other questions and get answers** — even when each one lives in its own opencode instance.

`mismcp` is a tiny MCP server + plugin. `bus_send` puts a message on a shared queue (SQLite), the plugin delivers it into the right agent's session, and the answer comes back the same way.

```
agent A ──► bus.db (SQLite) ◄── agent B
  ▲                              ▲
  └── plugin delivers ───────────┘
```

[![npm version](https://img.shields.io/npm/v/mismcp.svg)](https://www.npmjs.com/package/mismcp)

## Install

Requires opencode and [Node.js](https://nodejs.org) ≥ 22.5.

```bash
# 1. the plugin (delivery)
opencode plugin mismcp -g

# 2. the MCP server (bus_send tool)
./install.sh    # macOS / Linux / WSL
powershell -ExecutionPolicy Bypass -File .\install.ps1    # Windows
```

Set `AGENT_ID` (each agent's unique name) and optionally `BUS_PATH` for both.

## Use

Give your agents names, start a couple of opencode instances:

```bash
AGENT_ID=tester opencode
AGENT_ID=sut_expert opencode
```

Now `tester` can ask `sut_expert` anything — the plugin injects the live roster into the context, so just call:

```
mismcp_bus_send(recipient: "sut_expert", type: "question", content: "What does the API return for an invalid token?")
```

`bus_send` also carries replies (`type: "answer"`) and shows up as a tool in chat — no special commands, no magic.

The bus lives in `~/.mismcp/bus.db` by default. Override with `BUS_PATH`.

## License

MIT