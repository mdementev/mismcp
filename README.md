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

## Get started

Start a couple of instances. `AGENT_ID` is optional — if you omit it, the plugin derives a name for you:

```bash
AGENT_ID=tester opencode
opencode            # auto-named from the working directory
```

The plugin injects the live roster into the session context — a line like `Available agents to ask via mismcp_bus_send: sut_expert` — then just call the tool:

```
mismcp_bus_send(recipient: "sut_expert", type: "question", content: "What does the API return for an invalid token?")
```

Replies come back the same way (`type: "answer"`). Everything runs in-process inside the opencode runtime — no Node, no config, no extra services.

`BUS_PATH` is optional and defaults to `~/.mismcp/bus.db`.

## Config file

On first run the plugin creates `~/.config/opencode/mismcp.jsonc` if it does not
exist yet (JSONC — comments allowed). Edit it and restart opencode to apply:

```jsonc
{
  // Name for this agent. Tokens: {dir} {worktree} {projectId} {host} {user} {pid}.
  // A 6-char base36 suffix is always appended. For a stable, suffix-free name,
  // set the AGENT_ID env var instead — it wins over this file.
  "nameTemplate": "{dir}-agent",

  // Shared SQLite queue. Default: ~/.mismcp/bus.db. Override with the BUS_PATH env var.
  "busPath": "~/.mismcp/bus.db"
}
```

A project can override it with `<project>/.opencode/mismcp.jsonc` (or `.json`);
the project file wins. This is read by the plugin itself, so it works no matter
how the plugin was loaded — via the `plugin` config array or auto-discovered from
the `plugin/`/`plugins/` directory. Set `MISMCP_CONFIG_DIR` to relocate the file.

## Agent names

Every instance always gets a name. The first source that is set wins:

1. `AGENT_ID` — used verbatim (stable, no suffix).
2. `MISMCP_NAME_TEMPLATE` env var.
3. `nameTemplate` in the config file (`~/.config/opencode/mismcp.jsonc`, or the project override).
4. `nameTemplate` plugin option.
5. default `{dir}`.

For template-derived names, the rendered template is normalized to `[a-z0-9_-]`
and a 6-character base36 suffix is always appended, so several agents can share
one directory without colliding. `AGENT_ID` is the exception — it is used
verbatim, with no suffix. Auto-generated names are ephemeral: they change on
every restart. Set `AGENT_ID` when you need a stable, addressable name.

Template tokens: `{dir}`, `{worktree}`, `{projectId}`, `{host}`, `{user}`,
`{pid}`. Unknown tokens are dropped; a template that normalizes to nothing falls
back to `agent`. Example: `MISMCP_NAME_TEMPLATE='{dir}-agent'` gives names like
`opencode-plugin-agent-3rkog4`.

The `nameTemplate` plugin option is only a fallback — the config file above is
preferred, so you rarely need it:

```jsonc
// opencode.json — optional, only if you don't want a config file
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["mismcp", { "nameTemplate": "agent-{dir}" }]]
}
```

## Storage

Everything lives in one SQLite file — `BUS_PATH`, default `~/.mismcp/bus.db`.
Messages and agent registrations older than **2 days** are deleted automatically
(on startup and then hourly while an instance is running), so the file does not
grow without bound. Undelivered messages older than the window are dropped too.
The retention window is currently not configurable.

## Examples

Ready-made launcher scripts that set the env vars for you:

- Windows: [agents-startup-scripts-demo/windows](https://github.com/mdementev/mismcp/tree/main/agents-startup-scripts-demo/windows) — `tester.bat`, `analyst.bat`, etc.
- macOS: [agents-startup-scripts-demo/mac](https://github.com/mdementev/mismcp/tree/main/agents-startup-scripts-demo/mac) — `tester.command`, `analyst.command`, etc.

Each `isolated/` variant gives every agent its own working directory.

## License

MIT