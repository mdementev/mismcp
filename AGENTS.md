# Agent Bus

Переписка между агентами opencode через плагин `mismcp`.

## Адресаты

Агенты идентифицируются по `AGENT_ID`. Ожидаемые по умолчанию: `tester`, `sut_expert`.
Если `AGENT_ID` не задан, плагин назначает имя автоматически (имя рабочей директории + base36-суффикс); такое имя эфемерно, стабильное задавай через `AGENT_ID`.
Актуальный список живых адресатов инжектится в контекст плагином (`Available agents to ask via mismcp_bus_send: ...`).

## Как спросить другого агента

Чтобы задать вопрос другому агенту, вызови тул:

```
mismcp_bus_send(recipient: "<AGENT_ID>", type: "question", content: "<ваш вопрос>")
```

## Как отвечать

Когда плагин доставляет тебе вопрос (`Question from X: ...`), при необходимости исследуй, затем отправь структурированный ответ через:

```
mismcp_bus_send(recipient: "<X>", type: "answer", content: "<полный ответ>")
```

Финальный ответ клади в аргумент тула, а не в чат.

## Хранилище

Общий файл — `~/.mismcp/bus.db` (переопределяется `BUS_PATH`). Сообщения и регистрации агентов старше 2 суток удаляются автоматически (при запуске и далее раз в час), поэтому файл не растёт бесконечно. Недоставленные сообщения старше этого срока тоже удаляются.

---

# Agent Bus

Inter-agent messaging for opencode through the `mismcp` plugin. Agents can ask each other questions and receive answers, even when each agent runs in a separate opencode instance.

## Recipients

Agents are identified by `AGENT_ID`. Expected defaults: `tester`, `sut_expert`.
If `AGENT_ID` is unset, the plugin assigns a name automatically (working-directory name + base36 suffix); that name is ephemeral, so set `AGENT_ID` for a stable one.
The live list of online recipients is injected into your context by the plugin (`Available agents to ask via mismcp_bus_send: ...`).

## Asking another agent

To ask another agent a question, call:

```
mismcp_bus_send(recipient: "<AGENT_ID>", type: "question", content: "<your question>")
```

## Answering

When the plugin delivers a question to you (`Question from X: ...`), research if needed, then send a structured answer via:

```
mismcp_bus_send(recipient: "<X>", type: "answer", content: "<your full answer>")
```

Put the final answer in the tool argument, not in chat.

## Storage

The shared file is `~/.mismcp/bus.db` (override with `BUS_PATH`). Messages and agent registrations older than 2 days are deleted automatically (on startup and hourly thereafter), so the file does not grow without bound. Undelivered messages older than the window are dropped too.
