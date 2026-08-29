# mismcp

Переписка между агентами opencode через общую шину. Агент может задать вопрос другому агенту и получить ответ — даже если другой агент работает в отдельном процессе opencode.

- **MCP-сервер `mismcp`** — единственный тул `bus_send`: агент отправляет сообщение в общую очередь.
- **Плагин** — доставка: опрашивает очередь, пушит входящие сообщения в сессию агента, отвечает на них через `bus_send`.

## Архитектура

```
opencode A (AGENT_ID=tester)            opencode B (AGENT_ID=sut_expert)
 ├─ MCP «mismcp»: bus_send  ──►  bus.db (SQLite/WAL)  ◄── bus_send: MCP «mismcp»
 └─ плагин: poll → push в сессию        ▲                └─ плагин: poll → push в сессию
```

Шина — общий SQLite-файл `~/.mismcp/bus.db` (WAL, busy_timeout), поэтому даже отдельные процессы opencode читают/пишут одну очередь.

## Требования

- [opencode](https://opencode.ai) (TUI)
- [bun](https://bun.sh) ≥ 1.4

## Установка

```bash
cd bus && bun install
cd ../.opencode && bun install
```

Плагин лежит в `.opencode/plugins/mismcp.ts` и автозагружается при старте. MCP-сервер указан в `opencode.json` (локальный, запускается через `bun run ./bus/src/mcp-server.ts`).

## Настройка

Конфигурация уже в `opencode.json`: сервер `mismcp` берёт `AGENT_ID` и `BUS_PATH` из окружения (`{env:...}`). Ничего менять не нужно, если дефолты подходят:

| Переменная | Дефолт | Назначение |
|---|---|---|
| `AGENT_ID` | — | идентичность агента, обязательна |
| `BUS_PATH` | `~/.mismcp/bus.db` | путь к файлу очереди |

Если `AGENT_ID` не задан или пуст, плагин пишет предупреждение в лог и не включается.

## Запуск двух инстансов

В двух терминалах:

```bash
# терминал 1
AGENT_ID=tester opencode

# терминал 2
AGENT_ID=sut_expert opencode
```

Инстансы могут работать из любых папок и проектов — шина по умолчанию общая (`~/.mismcp/bus.db`), а идентичность задаётся через `AGENT_ID`.

## Использование

В сессии `tester`:

> Спроси у sut_expert, как устроен сервис входа.

Агент вызовет `mismcp_bus_send(recipient: "sut_expert", type: "question", content: "...")`. Плагин на стороне `sut_expert` доставит вопрос в его сессию; `sut_expert` исследует и отправит структурированный ответ через `bus_send(..., type: "answer", ...)`. Плагин на стороне `tester` доставит ответ обратно.

Имя тула — `mismcp_bus_send` (префикс = имя MCP-сервера).

## Схема базы

**`messages`** — очередь:

| колонка | тип | примечание |
|---|---|---|
| `id` | TEXT | uuid, PK |
| `from` | TEXT | AGENT_ID отправителя (из env, агентом не передаётся) |
| `recipient` | TEXT | AGENT_ID получателя |
| `type` | TEXT | `question` \| `answer` |
| `content` | TEXT | тело сообщения |
| `created_at` | INT | unix-ms |
| `acked` | INT | 0/1, обработано плагином |

**`agents`** — heartbeat-реестр:

| колонка | тип | примечание |
|---|---|---|
| `agent_id` | TEXT | PK, AGENT_ID |
| `last_seen` | INT | обновляется плагином каждый poll (~3с) |

Живыми считаются записи с `last_seen` не старше 30с — отвалившийся инстанс исчезает из ростера.

## Поведение плагина

- `AGENT_ID` пуст → пуш отключён.
- Каждые ~3с: heartbeat → ростер → проверка инбокса.
- Ростер (`Available agents to ask via mismcp_bus_send: ...`) инжектится в сессии при изменении и при создании новой сессии.
- Входящее сообщение пушится в последнюю активную (не занятую) сессию этого инстанса:
  - `question`: «Вопрос от X: ... Исследуй и отправь структурированный ответ X через mismcp_bus_send(..., type: "answer", ...). Финальный ответ — в аргументе тула.»
  - `answer`: «Ответ от X: ...» — без инструкции отвечать.
- После успешного пуша сообщение помечается `acked`. Если сессия занята — сообщение остаётся в очереди и доставляется следующим poll'ом.

## Troubleshooting

- **Тул не виден агенту**: проверь, что MCP-сервер поднялся — `opencode mcp list` (имя `mismcp`), и что `AGENT_ID` задан.
- **Логи плагина**: запусти opencode с `--print-logs --log-level DEBUG` (сервис `mismcp`).
- **Разные базы**: убедись, что оба инстанса видят один `BUS_PATH` (по умолчанию `~/.mismcp/bus.db`).

---

# mismcp

Inter-agent messaging for opencode over a shared bus. An agent can ask another agent a question and get an answer — even when the other agent runs in a separate opencode instance.

- **MCP server `mismcp`** — a single tool `bus_send`: an agent sends a message to the shared queue.
- **Plugin** — delivery: polls the queue, pushes incoming messages into the agent's session, and replies through `bus_send`.

## Architecture

```
opencode A (AGENT_ID=tester)            opencode B (AGENT_ID=sut_expert)
 ├─ MCP "mismcp": bus_send  ──►  bus.db (SQLite/WAL)  ◄── bus_send: MCP "mismcp"
 └─ plugin: poll → push to session       ▲                └─ plugin: poll → push to session
```

The bus is a shared SQLite file `~/.mismcp/bus.db` (WAL, busy_timeout), so even separate opencode processes read and write a single queue.

## Requirements

- [opencode](https://opencode.ai) (TUI)
- [bun](https://bun.sh) ≥ 1.4

## Installation

```bash
cd bus && bun install
cd ../.opencode && bun install
```

The plugin lives in `.opencode/plugins/mismcp.ts` and is auto-loaded on startup. The MCP server is wired up in `opencode.json` (local, started via `bun run ./bus/src/mcp-server.ts`).

## Configuration

The config is already in `opencode.json`: the `mismcp` server takes `AGENT_ID` and `BUS_PATH` from the environment (`{env:...}`). Nothing to change if the defaults fit:

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_ID` | — | agent identity, required |
| `BUS_PATH` | `~/.mismcp/bus.db` | path to the queue file |

If `AGENT_ID` is unset or empty, the plugin logs a warning and stays disabled.

## Running two instances

In two terminals:

```bash
# terminal 1
AGENT_ID=tester opencode

# terminal 2
AGENT_ID=sut_expert opencode
```

Instances can run from any folder or project — the bus is shared by default (`~/.mismcp/bus.db`), and identity comes from `AGENT_ID`.

## Usage

In the `tester` session:

> Ask sut_expert how the login service works.

The agent will call `mismcp_bus_send(recipient: "sut_expert", type: "question", content: "...")`. The plugin on the `sut_expert` side delivers the question into its session; `sut_expert` researches and sends a structured answer via `bus_send(..., type: "answer", ...)`. The plugin on the `tester` side delivers the answer back.

The tool name is `mismcp_bus_send` (prefix = MCP server name).

## Database schema

**`messages`** — the queue:

| column | type | notes |
|---|---|---|
| `id` | TEXT | uuid, PK |
| `from` | TEXT | sender AGENT_ID (from env, not passed by the agent) |
| `recipient` | TEXT | recipient AGENT_ID |
| `type` | TEXT | `question` \| `answer` |
| `content` | TEXT | message body |
| `created_at` | INT | unix-ms |
| `acked` | INT | 0/1, processed by the plugin |

**`agents`** — heartbeat roster:

| column | type | notes |
|---|---|---|
| `agent_id` | TEXT | PK, AGENT_ID |
| `last_seen` | INT | refreshed by the plugin on each poll (~3s) |

Entries with `last_seen` older than 30s are considered offline — a gone instance disappears from the roster.

## Plugin behavior

- Empty `AGENT_ID` → push disabled.
- Every ~3s: heartbeat → roster → inbox check.
- The roster (`Available agents to ask via mismcp_bus_send: ...`) is injected into sessions when it changes and when a new session is created.
- An incoming message is pushed into the latest active (not busy) session of this instance:
  - `question`: "Question from X: ... Research if needed, then send a structured answer to X via mismcp_bus_send(..., type: "answer", ...). Put the final answer in the tool argument."
  - `answer`: "Answer from X: ..." — with no instruction to reply.
- After a successful push the message is marked `acked`. If the session is busy — the message stays in the queue and is delivered on the next poll.

## Troubleshooting

- **The tool is not visible to the agent**: make sure the MCP server is up — `opencode mcp list` (name `mismcp`) — and that `AGENT_ID` is set.
- **Plugin logs**: run opencode with `--print-logs --log-level DEBUG` (service `mismcp`).
- **Different databases**: make sure both instances see the same `BUS_PATH` (default `~/.mismcp/bus.db`).
