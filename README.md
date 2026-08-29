# mismcp

Inter-agent messaging for opencode over a shared bus. An agent can ask another agent a question and get an answer — even when the other agent runs in a separate opencode instance.

- **MCP server `mismcp`** — a single tool `bus_send`: an agent sends a message to the shared queue.
- **Plugin** — delivery: polls the queue, pushes incoming messages into the agent's session, and replies through `bus_send`.

---

# mismcp (RU)

Переписка между агентами opencode через общую шину. Агент может задать вопрос другому агенту и получить ответ — даже если другой агент работает в отдельном процессе opencode.

- **MCP-сервер `mismcp`** — единственный тул `bus_send`: агент отправляет сообщение в общую очередь.
- **Плагин** — доставка: опрашивает очередь, пушит входящие сообщения в сессию агента, отвечает на них через `bus_send`.

## Архитектура

```
opencode A (AGENT_ID=tester)            opencode B (AGENT_ID=sut_expert)
 ├─ MCP «mismcp»: bus_send  ──►  bus.db (SQLite/WAL)  ◄── bus_send: MCP «mismcp»
 └─ плагин: poll → push в сессию        ▲                └─ плагин: poll → push в сессию
```

Шина — общий SQLite-файл `.mismcp/bus.db` в корне проекта (WAL, busy_timeout), поэтому даже отдельные процессы opencode читают/пишут одну очередь.

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
| `BUS_PATH` | `<проект>/.mismcp/bus.db` | путь к файлу очереди |

Если `AGENT_ID` не задан или пуст, плагин пишет предупреждение в лог и не включается.

## Запуск двух инстансов

В двух терминалах, из корня проекта:

```bash
# терминал 1
AGENT_ID=tester opencode

# терминал 2
AGENT_ID=sut_expert opencode
```

Оба инстанса работают на одном проекте, но с разной идентичностью. Шина общая.

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
- Входящее сообщение пушится в последнюю активную (не занятую) сессию проекта:
  - `question`: «Вопрос от X: ... Исследуй и отправь структурированный ответ X через mismcp_bus_send(..., type: "answer", ...). Финальный ответ — в аргументе тула.»
  - `answer`: «Ответ от X: ...» — без инструкции отвечать.
- После успешного пуша сообщение помечается `acked`. Если сессия занята — сообщение остаётся в очереди и доставляется следующим poll'ом.

## Troubleshooting

- **Тул не виден агенту**: проверь, что MCP-сервер поднялся — `opencode mcp list` (имя `mismcp`), и что `AGENT_ID` задан.
- **Логи плагина**: запусти opencode с `--print-logs --log-level DEBUG` (сервис `mismcp`).
- **Разные базы**: убедись, что оба инстанса видят один `BUS_PATH` (по умолчанию `.mismcp/bus.db` в корне проекта). MCP-сервер резолвит дефолт от `process.cwd()` — запускай opencode из корня проекта.
