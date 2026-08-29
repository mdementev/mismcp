# mismcp — stateful multi-agent for opencode

**Stateful multi-agent bus for opencode**: inter-agent messaging over a shared SQLite bus. An agent can ask another agent a question and get an answer — even when the other agent runs in a separate opencode instance.

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
- [Node.js](https://nodejs.org) ≥ 22.5 (built-in `node:sqlite`)

## Installation (global)

The installer copies `bus` and the plugin into the global opencode config, installs npm dependencies, builds the MCP server (`tsc`), and wires the MCP entry into `opencode.json` (without overwriting your other settings):

```bash
# macOS / Linux / WSL
./install.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Requires [Node.js](https://nodejs.org) ≥ 22.5. If `~/.config/opencode/opencode.jsonc` already exists, the script does not touch it — add the MCP entry manually. Re-running the script (e.g. after pulling updates) just reinstalls.

Bun is no longer required: opencode is a self-contained binary with its own embedded Bun runtime (which runs the plugin), and the MCP server runs on Node with the built-in `node:sqlite`. On Windows machines where bun is blocked by corporate policy, having Node installed is enough.

### Manual installation

The global opencode config lives in `~/.config/opencode/` (macOS/Linux) or `%USERPROFILE%\.config\opencode\` (Windows). All commands below assume you are in the repo checkout directory.

**1. Copy the bus package and build it**

macOS / Linux:

```bash
mkdir -p ~/.config/opencode
cp -R bus ~/.config/opencode/bus
cd ~/.config/opencode/bus && npm install && npm run build
```

Windows (PowerShell):

```powershell
$dest = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force .\bus "$dest\bus"
Push-Location "$dest\bus"
npm install
npm run build
Pop-Location
```

**2. Copy the plugin**

macOS / Linux:

```bash
mkdir -p ~/.config/opencode/plugins
cp plugin/mismcp.ts ~/.config/opencode/plugins/
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path "$dest\plugins" | Out-Null
Copy-Item -Force .\plugin\mismcp.ts "$dest\plugins\"
```

**3. Wire the MCP server into `opencode.json`**

The plugin is auto-loaded from `plugins/mismcp.ts` by every opencode instance. The MCP server must be declared in the global `opencode.json` (or `opencode.jsonc`, if that file already exists). The `command` takes the **absolute path** to the built server on your OS:

| OS | path in `command` |
|---|---|
| macOS / Linux | `/Users/<you>/.config/opencode/bus/dist/mcp-server.js` |
| Windows | `C:\Users\<you>\.config\opencode\bus\dist\mcp-server.js` (backslashes JSON-escaped: `\\`) |

```jsonc
{
  "mcp": {
    "mismcp": {
      "type": "local",
      "command": ["node", "--experimental-sqlite", "/Users/<you>/.config/opencode/bus/dist/mcp-server.js"],
      "environment": {
        "AGENT_ID": "{env:AGENT_ID}",
        "BUS_PATH": "{env:BUS_PATH}"
      }
    }
  }
}
```

The `--experimental-sqlite` flag is required for Node 22.5–22.12 and is harmless on newer versions.

Then **restart opencode** for the config to take effect.

## Configuration

The `mismcp` server takes `AGENT_ID` and `BUS_PATH` from the environment (`{env:...}`). Nothing to change if the defaults fit:

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_ID` | — | agent identity, required |
| `BUS_PATH` | `~/.mismcp/bus.db` | path to the queue file |

If `AGENT_ID` is unset or empty, the plugin logs a warning and stays disabled.

## Running two instances

In two terminals:

```bash
# macOS / Linux — terminal 1
AGENT_ID=tester opencode

# macOS / Linux — terminal 2
AGENT_ID=sut_expert opencode
```

```powershell
# Windows (PowerShell) — terminal 1
$env:AGENT_ID = "tester"; opencode

# Windows (PowerShell) — terminal 2
$env:AGENT_ID = "sut_expert"; opencode
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
- A message is claimed (acked) from the queue as soon as a poll picks it, **before** the push into the session, so overlapping polls never deliver it twice. There are no retries: if the push fails or no suitable session exists, the message is treated as handled and forgotten (the error is logged). The push uses non-blocking `promptAsync` — the poll loop does not wait for the agent's full reply.

## Troubleshooting

- **The tool is not visible to the agent**: make sure the MCP server is up — `opencode mcp list` (name `mismcp`) — and that `AGENT_ID` is set.
- **Plugin logs**: run opencode with `--print-logs --log-level DEBUG` (service `mismcp`).
- **Different databases**: make sure both instances see the same `BUS_PATH` (default `~/.mismcp/bus.db`).

---

# mismcp — stateful multi-agent for opencode

**Stateful мультиагентный агент-бас для opencode**: переписка между агентами через общую SQLite-шину. Агент может задать вопрос другому агенту и получить ответ — даже если другой агент работает в отдельном процессе opencode.

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
- [Node.js](https://nodejs.org) ≥ 22.5 (встроенный модуль `node:sqlite`)

## Установка (глобально)

Скрипт установки копирует `bus` и плагин в глобальный конфиг opencode, ставит npm-зависимости, собирает MCP-сервер (`tsc`) и прописывает MCP-запись в `opencode.json` (не перезаписывая остальные настройки):

```bash
# macOS / Linux / WSL
./install.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Требуется [Node.js](https://nodejs.org) ≥ 22.5. Если в `~/.config/opencode/` уже есть `opencode.jsonc` — скрипт его не трогает, MCP-запись добавь вручную. Повторный запуск (после обновления репозитория) просто переустанавливает.

Bun больше не нужен: opencode — самодостаточный бинарник со встроенным Bun-рантаймом (на нём исполняется плагин), а MCP-сервер запускается на Node с встроенным `node:sqlite`. На Windows, где bun заблокирован корпоративной политикой, достаточно установленного Node.

### Ручная установка

Глобальный конфиг opencode лежит в `~/.config/opencode/` (macOS/Linux) или `%USERPROFILE%\.config\opencode\` (Windows). Все команды ниже выполняются из каталога репозитория.

**1. Скопировать пакет `bus` и собрать его**

macOS / Linux:

```bash
mkdir -p ~/.config/opencode
cp -R bus ~/.config/opencode/bus
cd ~/.config/opencode/bus && npm install && npm run build
```

Windows (PowerShell):

```powershell
$dest = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force .\bus "$dest\bus"
Push-Location "$dest\bus"
npm install
npm run build
Pop-Location
```

**2. Скопировать плагин**

macOS / Linux:

```bash
mkdir -p ~/.config/opencode/plugins
cp plugin/mismcp.ts ~/.config/opencode/plugins/
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path "$dest\plugins" | Out-Null
Copy-Item -Force .\plugin\mismcp.ts "$dest\plugins\"
```

**3. Прописать MCP-сервер в `opencode.json`**

Плагин автозагружается из `plugins/mismcp.ts` каждым инстансом opencode. MCP-сервер нужно объявить в глобальном `opencode.json` (или `opencode.jsonc`, если такой файл уже есть). В `command` указывается **абсолютный путь** к собранному серверу под вашу ОС:

| ОС | путь в `command` |
|---|---|
| macOS / Linux | `/Users/<you>/.config/opencode/bus/dist/mcp-server.js` |
| Windows | `C:\Users\<you>\.config\opencode\bus\dist\mcp-server.js` (обратные слэши экранируются в JSON как `\\`) |

```jsonc
{
  "mcp": {
    "mismcp": {
      "type": "local",
      "command": ["node", "--experimental-sqlite", "/Users/<you>/.config/opencode/bus/dist/mcp-server.js"],
      "environment": {
        "AGENT_ID": "{env:AGENT_ID}",
        "BUS_PATH": "{env:BUS_PATH}"
      }
    }
  }
}
```

Флаг `--experimental-sqlite` нужен для Node 22.5–22.12 и безвреден на новых версиях.

Затем **перезапусти opencode**, чтобы конфиг применился.

## Настройка

Сервер `mismcp` берёт `AGENT_ID` и `BUS_PATH` из окружения (`{env:...}`). Ничего менять не нужно, если дефолты подходят:

| Переменная | Дефолт | Назначение |
|---|---|---|
| `AGENT_ID` | — | идентичность агента, обязательна |
| `BUS_PATH` | `~/.mismcp/bus.db` | путь к файлу очереди |

Если `AGENT_ID` не задан или пуст, плагин пишет предупреждение в лог и не включается.

## Запуск двух инстансов

В двух терминалах:

```bash
# macOS / Linux — терминал 1
AGENT_ID=tester opencode

# macOS / Linux — терминал 2
AGENT_ID=sut_expert opencode
```

```powershell
# Windows (PowerShell) — терминал 1
$env:AGENT_ID = "tester"; opencode

# Windows (PowerShell) — терминал 2
$env:AGENT_ID = "sut_expert"; opencode
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
- Сообщение «забирается» из очереди (ack) сразу при подборе poll'ом, **до** пуша в сессию, поэтому перекрывающиеся poll'ы не доставят его повторно. Ретраев нет: если пуш не удался или подходящей сессии нет — сообщение считается обработанным и забывается (в лог пишется ошибка). Пуш — неблокирующий `promptAsync`, poll-цикл не висит до полного ответа агента.

## Troubleshooting

- **Тул не виден агенту**: проверь, что MCP-сервер поднялся — `opencode mcp list` (имя `mismcp`), и что `AGENT_ID` задан.
- **Логи плагина**: запусти opencode с `--print-logs --log-level DEBUG` (сервис `mismcp`).
- **Разные базы**: убедись, что оба инстанса видят один `BUS_PATH` (по умолчанию `~/.mismcp/bus.db`).