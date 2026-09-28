# TradeView — Architecture & Contracts

A self-hosted TradingView-style platform, written in plain JavaScript (ESM, Node >= 20).
Market data comes from Bybit, Pine Script runs through `pinets`, Claude drives an
in-app agent, and Laya (`@receptron/laya`, ONNX, runs in-process) is the decision gate for alerts.

**Every module must follow this document.** If you need to change a contract, update this file.

```
tradeview/
  package.json            # npm workspaces: server, web. Scripts: dev, build, start, backfill, test
  .env.example            # ANTHROPIC_API_KEY, CLAUDE_MODEL, PORT, DB_PATH, LAYA_MODE, LAYA_URL, ...
  server/                 # Node backend (Fastify + ws + better-sqlite3)
    src/
      index.js            # boots everything, serves web/dist in production
      config.js           # reads env, exports config object
      db/                 # sqlite schema + candle/trade/alert repositories
      bybit/              # REST client (rate limited), WS client (auto-reconnect), instruments
      data/               # backfill, candle aggregation, footprint aggregation, live hub
      pine/               # PineTS runner
      backtest/           # strategy engine (Pine strategies + JS strategies), metrics
      alerts/             # alert engine, evaluation on live ticks, Laya gate
      laya/               # Laya decision service (in-process ONNX or HTTP laya-serve)
      agent/              # Claude agent: tool definitions, tool-use loop, chart commands
      api/                # REST routes + WS gateway
    scripts/backfill.js   # CLI: backfill >= 1 year for all timeframes
    test/                 # node:test unit tests
  web/                    # Vite + vanilla JS frontend
    index.html
    src/
      main.js             # app bootstrap
      api/                # REST + WS client (single shared socket, auto-reconnect)
      chart/              # chart core on lightweight-charts v5: series, footprint, drawings, indicators
      layout/             # multi-chart grid (1, 2h, 2v, 3, 4, 6, 8), sync crosshair/symbol/interval
      replay/             # bar replay client (play/pause/step/speed/jump)
      panels/             # watchlist, chat, alerts, pine editor, strategy tester, object tree
      audio/              # loud alarm (WebAudio) + Notification API
      styles/
```

## 1. Symbols & markets

Bybit v5 public API (`https://api.bybit.com`, WS `wss://stream.bybit.com/v5/public/{category}`).

- `category`: `spot` | `linear` | `inverse`.
- Symbol key used everywhere: `"{category}:{symbol}"`, e.g. `linear:BTCUSDT`, `spot:ETHUSDT`.
- Market groups (derived from instruments-info, shown as watchlist tabs):
  - `crypto`: everything not below.
  - `commodities`: gold/silver/oil-linked instruments Bybit lists (e.g. `XAUTUSDT`, `PAXGUSDT`, and any
    `XAU*`, `XAG*`, `*OIL*` symbols returned by instruments-info).
  - `forex`: FX-linked instruments Bybit lists (e.g. `EURUSDT` spot and any fiat-pair symbols returned).
  Classification lives in `server/src/bybit/markets.js` as a regex table so it is easy to extend.
  Bybit's public API only lists the instruments it trades, so the forex/commodity lists depend on what it returns.

## 2. Timeframes

Canonical interval ids (strings), and the Bybit mapping:

| id  | bybit | ms        |
|-----|-------|-----------|
| 1m  | 1     | 60000     |
| 3m  | 3     |           |
| 5m  | 5     |           |
| 15m | 15    |           |
| 30m | 30    |           |
| 1h  | 60    |           |
| 2h  | 120   |           |
| 4h  | 240   |           |
| 6h  | 360   |           |
| 12h | 720   |           |
| 1D  | D     |           |
| 1W  | W     |           |
| 1M  | M     |           |

Plus custom seconds charts `1s`, `5s`, `15s`, `30s` built from live trades only.
Defined once in `server/src/data/timeframes.js` and mirrored in `web/src/chart/timeframes.js`.

## 3. Data model (SQLite, `DB_PATH`, WAL mode)

```sql
candles(symbol TEXT, tf TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, qv REAL,
        PRIMARY KEY(symbol, tf, t)) WITHOUT ROWID;
footprint(symbol TEXT, tf TEXT, t INTEGER, price REAL, bid_v REAL, ask_v REAL,
        PRIMARY KEY(symbol, tf, t, price)) WITHOUT ROWID;
backfill_state(symbol TEXT, tf TEXT, oldest INTEGER, newest INTEGER, PRIMARY KEY(symbol, tf));
alerts(id TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER, status TEXT);
alert_events(id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT, t INTEGER, json TEXT);
drawings(id TEXT PRIMARY KEY, symbol TEXT, json TEXT);
chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, role TEXT, json TEXT, t INTEGER);
```

`t` is the bar open time in ms UTC. Candle object in JSON everywhere:
`{ t, o, h, l, c, v }` (numbers). Footprint bar: `{ t, levels: [{ p, bid, ask }], poc, delta, tick }`.

### Backfill (`npm run backfill -- --symbols linear:BTCUSDT,... --days 365 --tf all`)
- Pages `GET /v5/market/kline` (limit 1000) backwards until `now - days`. Stores all 13 native tfs directly
  (no derivation needed, Bybit serves them all); resumable through `backfill_state`.
- Rate limit: token bucket, default 10 req/s, retries with backoff on 10006/429.
- Default symbol set in config: top-N linear USDT perps by turnover + all commodity + forex group symbols.
- Footprint history: optional `--footprint` downloads daily trade dumps from
  `https://public.bybit.com/trading/{SYMBOL}/{SYMBOL}{YYYY-MM-DD}.csv.gz` (linear) and
  `https://public.bybit.com/spot/{SYMBOL}/...` (spot) and aggregates them into the `footprint` table for
  tfs 1m..1h. Tick size used for price bucketing = instrument tickSize * `FOOTPRINT_TICK_MULT` (default auto).
- On server start, a gap filler brings every subscribed symbol/tf up to date.

### Live
- `LiveHub` subscribes Bybit WS `kline.{interval}.{symbol}` + `publicTrade.{symbol}` on demand (ref-counted
  by browser subscriptions and active alerts). Upserts closed candles into SQLite. Builds live footprint
  and second-bars from trades.

## 4. REST API (all JSON, prefix `/api`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/symbols?group=crypto\|forex\|commodities&q=` | `[{ key, symbol, category, group, base, quote, tickSize, qtyStep }]` |
| GET | `/api/candles?symbol=&tf=&from=&to=&limit=` | `{ candles: Candle[] }` ascending. Missing range in DB is fetched from Bybit on the fly. Max limit 5000. |
| GET | `/api/footprint?symbol=&tf=&from=&to=` | `{ bars: FootprintBar[] }` |
| POST | `/api/pine/run` | `{ symbol, tf, source, from?, to? }` → `{ plots: { [name]: { data:[{t,value}], options } }, meta: { title, overlay }, error? }` |
| POST | `/api/backtest` | `{ symbol, tf, from, to, source? (Pine strategy), strategy? (builtin id + params), capital, commission, slippage }` → `{ trades, equity:[{t,value}], metrics }` |
| GET/POST/PATCH/DELETE | `/api/alerts[/:id]` | Alert CRUD (schema §6) |
| GET | `/api/alerts/events?limit=` | fired alert history |
| GET/PUT/DELETE | `/api/drawings?symbol=` / `/api/drawings/:id` | persisted drawings |
| POST | `/api/chat` | `{ session, message, context }` → server-sent events stream (see §7) |
| GET | `/api/laya/status` | `{ ready, mode, model }` |
| GET | `/api/health` | `{ ok, bybit, db, laya }` |

## 5. WebSocket (`/ws`), JSON messages `{ type, ... }`

Client → server:
- `{ type:"subscribe", channel:"kline", symbol, tf }` / `unsubscribe`
- `{ type:"subscribe", channel:"footprint", symbol, tf }` / `unsubscribe`
- `{ type:"subscribe", channel:"trades", symbol }` / `unsubscribe`
- `{ type:"ping" }`

Server → client:
- `{ type:"kline", symbol, tf, candle, closed }`
- `{ type:"footprint", symbol, tf, bar }`
- `{ type:"trade", symbol, trades:[{ t, p, q, side:"Buy"|"Sell" }] }`
- `{ type:"alert", event: AlertEvent }`   ← triggers loud alarm in UI
- `{ type:"alert_update", alert }`
- `{ type:"chart_command", command }`     ← agent-issued commands (§7), also delivered in chat stream
- `{ type:"pong" }`, `{ type:"status", bybit:"connected"|"reconnecting" }`

## 6. Alerts

```js
Alert = {
  id, symbol, tf,                     // tf used for indicator conditions
  name, message,
  condition: {
    kind: "price",                    // price crosses / is above / is below a level
    op: "crosses"|"crosses_up"|"crosses_down"|"above"|"below"|"enters_channel"|"exits_channel",
    value, value2?                    // value2 for channels
  } | {
    kind: "indicator",                // Pine expression evaluated on each closed bar via PineTS
    source,                           // Pine script whose `alertcondition`/last plot named "signal" > 0 fires
  } | {
    kind: "drawing", drawingId, op    // price vs a trendline/horizontal drawing
  },
  trigger: "once"|"once_per_bar"|"once_per_bar_close"|"every_time",
  expires?: ms,
  laya: {                             // Laya decision gate (optional, default on for agent-created alerts)
    enabled: true,
    question: "Is this breakout likely to continue rather than fail?",
    threshold: 0.6                    // fire only if P(true) >= threshold
  },
  sound: { preset:"siren"|"bell"|"klaxon"|"beep", volume: 0..1, repeat: n, loop: bool },
  createdBy: "user"|"agent",
  status: "active"|"triggered"|"paused"|"expired"
}
AlertEvent = { id, alertId, symbol, t, price, message, laya?: { p, passed, answers }, name }
```

The alert engine evaluates on every live trade/kline tick server-side, so alerts fire even when the chart
tab is not open. Fired → persist event → broadcast `{type:"alert"}` to all sockets. The browser plays the
loud alarm (loops until acknowledged if `loop`), shows a modal + system Notification.

**Laya gate**: when an alert condition is hit and `laya.enabled`, the engine builds a state object
(symbol, tf, price, last 50 candles summarised as OHLCV rows, key indicator values: RSI14, EMA20/50/200, ATR14,
volume z-score, distance to alert level, recent footprint delta), and asks Laya typed questions:
`{ decision: noul(question), direction: choice{bullish,bearish,neutral}, confidence: score[low,medium,high] }`.
Fires when `decision.noul >= threshold`. Result attached to the event. If Laya is unavailable the alert fires
with `laya: { skipped: true }` (never silently swallow an alert).

## 7. Claude agent

- `@anthropic-ai/sdk`, model from `CLAUDE_MODEL` (default `claude-opus-5-5`), streaming, manual tool-use loop.
- The browser sends `context` with each message: `{ charts:[{ id, symbol, tf, visibleRange, indicators, lastPrice }], activeChartId }`.
- Tools (server executes data tools; chart tools become `chart_command`s the browser executes):
  - data: `get_candles`, `get_symbols`, `run_pine`, `run_backtest`, `laya_decide`, `list_alerts`
  - chart: `set_symbol`, `set_timeframe`, `set_layout`, `add_indicator` (builtin id or Pine source),
    `remove_indicator`, `draw` (`hline|trendline|ray|rectangle|fib|long_position|short_position|text|arrow` with points `{t, price}`),
    `clear_drawings`, `set_chart_type` (`candles|bars|line|area|heikin|footprint|renko|range`), `start_replay` (`{from, speed}`)
  - alerts: `create_alert` (Alert minus id), `delete_alert`
- `/api/chat` streams SSE: `data: {"type":"text","delta":"..."}`, `{"type":"tool","name","input"}`,
  `{"type":"chart_command","command":{ "action":"draw", ... }}`, `{"type":"alert_created","alert"}`,
  `{"type":"done"}`, `{"type":"error","message"}`.
- `ChartCommand = { action, chartId?, ...params }` where action is the tool name.

## 8. Pine Script

- Server `pine/runner.js`: `new PineTS(candles)` with candles mapped to `{open,high,low,close,volume,openTime,closeTime}`,
  `await pineTS.run(source)`; normalises `plots` to `{ name: { data:[{t,value}], options } }`.
- Browser Pine editor (Monaco with a Pine language definition) → `POST /api/pine/run` → rendered as overlay or
  separate pane according to `indicator(overlay=...)`.
- Built-in indicator library = Pine sources shipped in `server/src/pine/library/*.pine` (SMA, EMA, BB, RSI, MACD,
  Stoch, ATR, VWAP, Supertrend, Ichimoku, Volume Profile helper, ...). `GET /api/pine/library` lists them.

## 9. Backtest & bar replay

- Server backtest engine replays candles bar-by-bar for Pine `strategy()` scripts (via PineTS output when it exposes
  strategy data; otherwise a signal convention: plots named `long_entry`, `long_exit`, `short_entry`, `short_exit`)
  and builtin JS strategies. Metrics: net profit, win rate, profit factor, max drawdown, Sharpe, Sortino, trades count,
  avg trade, largest win/loss, exposure.
- Bar replay is client-side: load history, cut at a chosen bar, then play/pause/step forward/step back/speed
  (0.5x–100x)/jump to date/exit. Replay supports a "paper trading" mode: buy/sell/close at replay price with a
  running P&L panel (forward-testing simulation). Indicators recompute on the visible replay slice.

## 10. Non-functional

- Plain JS ESM, no TypeScript. JSDoc types welcome.
- No secrets in the browser: Claude and Laya calls happen on the server only.
- `npm test` runs `node --test` in the server; pure functions (aggregation, footprint bucketing, alert conditions,
  backtest metrics, timeframe math) must have unit tests that run offline.
- Everything must degrade gracefully offline: the UI loads, shows a status badge, and uses cached SQLite data.

## 11. Server module interfaces (in-process)

`server/src/index.js` builds one `ctx` object and passes it to every module:

```js
ctx = {
  config,                       // server/src/config.js default export
  log,                          // fastify logger
  db,                           // better-sqlite3 Database (schema created by db/index.js)
  repos: { candles, footprint, alerts, alertEvents, drawings, chat },   // db/*.js repositories
  bybit: { rest, instruments }, // bybit/rest.js, bybit/instruments.js
  market: MarketData,           // data/market.js
  live: LiveHub,                // data/live.js (EventEmitter)
  broadcast(msg),               // send JSON to every connected browser socket
  laya: LayaService,            // laya/index.js
}
```

- `MarketData`: `getCandles({symbol, tf, from, to, limit}) -> Promise<Candle[]>` (DB first, fills gaps from Bybit),
  `getFootprint({symbol, tf, from, to}) -> Promise<FootprintBar[]>`, `listSymbols({group, q}) -> Promise<Symbol[]>`.
- `LiveHub extends EventEmitter`: `acquire(channel, symbol, tf?)` / `release(channel, symbol, tf?)` (ref-counted Bybit
  subscriptions; channel = `kline|trades|footprint`), `lastPrice(symbol) -> number|undefined`.
  Events: `'kline' ({symbol, tf, candle, closed})`, `'trades' ({symbol, trades, prevPrice})` (`prevPrice` = last price
  before this batch, undefined for the first one), `'footprint' ({symbol, tf, bar})`,
  `'status' ({bybit})`.
- `LayaService`: `status() -> {ready, mode, model}`, `decide(state, questions) -> Promise<{answers, usage?}|null>`
  (null when unavailable). Modes: `LAYA_MODE=local` (`@receptron/laya`, lazy dynamic import), `http` (`LAYA_URL`,
  `POST {LAYA_URL}/v1/systemone` of the Python `laya-serve`), `off`.
- Route modules export `async function register(app, ctx)`: `api/market.js`, `api/drawings.js`, `api/health.js`,
  `api/ws.js` (data team); `pine/routes.js`, `backtest/routes.js`, `alerts/routes.js`, `agent/routes.js`,
  `laya/routes.js` (intelligence team). `index.js` imports and registers all of them.
- Engines with lifecycle export `start(ctx)` / `stop()`: `alerts/engine.js` (listens to `ctx.live` events and keeps
  its symbols acquired).
- Shared helpers, importable by anyone: `data/timeframes.js` (`TIMEFRAMES`, `tfToMs(tf)`, `tfToBybit(tf)`,
  `floorTime(t, tf)`), `pine/runner.js` (`runPine({candles, source}) -> {plots, meta, strategy?, alerts?}`).

## 12. Web module interfaces

- `web/src/api/client.js`: `api.get(path, params)`, `api.post(path, body)`, `api.stream(path, body, onEvent)` (SSE via
  fetch), `socket` = singleton with `socket.send(msg)`, `socket.on(type, fn)`, `socket.subscribe(channel, symbol, tf)`
  / `unsubscribe(...)` (ref-counted, re-subscribes on reconnect).
- `web/src/chart/ChartView.js`: `new ChartView(containerEl, { id, symbol, tf, chartType })` with methods
  `setSymbol(s)`, `setTimeframe(tf)`, `setChartType(t)`, `addIndicator({ id?, builtin?, source?, inputs? }) -> id`,
  `removeIndicator(id)`, `listIndicators()`, `draw(spec) -> id`, `removeDrawing(id)`, `clearDrawings()`,
  `setDrawingTool(tool|null)`, `startReplay({from})`, `replay` (ReplayController), `getState()` (for agent context:
  `{id, symbol, tf, chartType, visibleRange:{from,to}, indicators, lastPrice}`), `onPriceClick(fn)` (used to create alerts
  from the chart), `showAlertLine(alert)` / `removeAlertLine(id)`, `executeCommand(cmd)` (ChartCommand §7), `destroy()`.
  Events via `chart.on(name, fn)`: `'symbol'`, `'tf'`, `'crosshair'`, `'price'` (last price), `'drawing'`, `'replay'`.
- `web/src/layout/Layout.js`: `new Layout(rootEl)`, `setLayout(id)` with ids `1, 2h, 2v, 3, 4, 6, 8`, `charts` (ChartView[]),
  `active` (ChartView), `on('active', fn)`, sync toggles `syncSymbol`, `syncInterval`, `syncCrosshair`, `syncTime`,
  `getContext()` → agent context §7, `executeCommand(cmd)` routes to `chartId` or active chart (handles `set_layout`).
- `web/src/replay/ReplayController.js`: `start(fromTime)`, `play()`, `pause()`, `stepForward(n=1)`, `stepBack(n=1)`,
  `setSpeed(x)`, `jumpTo(t)`, `stop()`, paper trading `buy(qty)`, `sell(qty)`, `closeAll()`, `positions`, `pnl`,
  events `'tick' | 'state' | 'fill'`.
- `web/src/audio/alarm.js`: `alarm.play({preset, volume, repeat, loop})`, `alarm.stop()`, `alarm.unlock()` (call on first
  user gesture), presets synthesised with WebAudio (no audio files needed): loud siren/klaxon/bell/beep.
- Panels are plain classes `new XPanel(el, { layout, api, socket })` in `web/src/panels/`.

## 13. Change set 2 (user requirements update) — supersedes earlier sections where they conflict

### 13.1 Delta Exchange is the PRIMARY market-data provider (Bybit stays as a second provider)
- Provider abstraction: `server/src/providers/{index.js,delta/,bybit/}` style (the data team may keep `bybit/` in place and add
  `delta/` alongside); `providers/index.js` routes by symbol-key prefix.
- Symbol keys: `delta:BTCUSD` (Delta), `linear:BTCUSDT` / `spot:BTCUSDT` (Bybit, unchanged). Default symbols and the default
  chart symbol are Delta's (e.g. `delta:BTCUSD`, `delta:ETHUSD`, `delta:SOLUSD`, ...). `/api/symbols` returns both providers,
  with `provider: "delta"|"bybit"` on each row, and a `provider` filter param.
- Delta REST: base `DELTA_REST` default `https://api.india.delta.exchange` (`DELTA_REGION=india|global`; global =
  `https://api.delta.exchange`). Public market data needs NO auth.
  - `GET /v2/history/candles?resolution=&symbol=&start=&end=` (start/end unix SECONDS; result `{success, result:[{time(sec),open,high,low,close,volume}]}`;
    page by time windows of <= 2000 candles; results may be unordered → sort ascending).
    Native resolutions: 1m 3m 5m 15m 30m 1h 2h 4h 6h 1d 1w (also 7d, 30d, 2w). Derive 12h from 6h, 1M from 1d, seconds tfs from trades.
  - `GET /v2/products` (paginated with `page_size` and `after` cursor from `meta.after`; fields `symbol`, `contract_type`
    e.g. perpetual_futures/futures/call_options/put_options/spot, `tick_size`, `underlying_asset.symbol`, `quoting_asset.symbol`, `state`).
    Default listing: live perpetual_futures + spot; options hidden behind a filter.
  - `GET /v2/tickers?contract_types=perpetual_futures`, `GET /v2/trades/{symbol}`.
  - Be defensive about field shapes (log and skip unknown rows) — the exact schemas could not be verified from this container.
- Delta WS: `DELTA_WS` default `wss://socket.india.delta.exchange` (global `wss://socket.delta.exchange`). Subscribe:
  `{"type":"subscribe","payload":{"channels":[{"name":"candlestick_1m","symbols":["BTCUSD"]},{"name":"all_trades","symbols":["BTCUSD"]}]}}`;
  channels `candlestick_{res}`, `all_trades`, `v2/ticker`. Heartbeat: send `{"type":"enable_heartbeat"}` and reconnect if no message for 35s.
- Footprint for Delta: no public trade dumps exist, so the 24/7 server RECORDS live `all_trades` for every symbol in
  `RECORD_SYMBOLS` (default = default symbols) into footprint (and a raw `trades` table, pruned after `TRADES_RETENTION_DAYS`,
  default 30), so footprint history accumulates from first start. Bybit symbols keep the public.bybit.com dump backfill.
- `DELTA_API_KEY` / `DELTA_API_SECRET` are optional config placeholders only (NOT needed for market data). Never log them,
  never commit real values.

### 13.2 Claude agent without an API key — Claude Code subscription driver
- `AGENT_DRIVER=claude-code` (DEFAULT) | `anthropic-api` | `off`.
- `claude-code` driver uses `@anthropic-ai/claude-agent-sdk` (installed) `query()` with an in-process SDK MCP server
  (`createSdkMcpServer` + `tool()`) exposing the §7 tools; restrict built-in tools (no Bash/Edit/Write/Read/WebFetch — only our
  MCP tools, via allowedTools / disallowedTools / tools options per the SDK typings), `permissionMode` that never blocks,
  `maxTurns` ~12, stream partial text to the SSE. Auth comes from the user's Claude Pro/Max login: on the server either the
  `claude` CLI has been logged in (`claude` → /login) or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) is set.
  If `ANTHROPIC_API_KEY` is set it takes precedence (SDK behaviour) — document it.
- Conversation continuity: keep the SDK session id per chat session (resume option) and also store messages in ctx.repos.chat.
- `anthropic-api` driver = the §7 Messages API loop (used only if `ANTHROPIC_API_KEY` set and `AGENT_DRIVER=anthropic-api`).
- Usage-limit / auth errors from the subscription must surface as a clear chat error ("Claude usage limit reached, resets at …"
  when available). Alerts NEVER depend on Claude: the alert engine + Laya keep working 24/7 even when Claude is unavailable.
- `GET /api/agent/status` → `{ driver, ready, detail }`.

### 13.3 24/7 web deployment
- Site authentication (the app will be on the public internet): `AUTH_PASSWORD` (or `AUTH_PASSWORD_HASH` scrypt) +
  `SESSION_SECRET`. `POST /api/auth/login {password}` → httpOnly, secure (in production), sameSite=lax signed cookie, 30d;
  `POST /api/auth/logout`; `GET /api/auth/me`. Every `/api/*` (except auth + health) and `/ws` require the cookie. Login
  rate-limited (5/min/IP). If AUTH_PASSWORD unset, auth disabled with a loud startup warning. Implemented in
  `server/src/auth/` by the data team; the login page `web/src/panels/Login.js` by the shell team (main.js shows it on 401).
- Alerts when no browser tab is open: Web Push (`web-push`, installed). Server `server/src/notify/` (intelligence team):
  VAPID keys auto-generated on first start and stored in DB `kv(key TEXT PRIMARY KEY, value TEXT)` table (data team adds the
  table + a `repos.kv` get/set), `GET /api/push/vapid`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, table
  `push_subscriptions(endpoint TEXT PRIMARY KEY, json TEXT)` (data team adds it + `repos.push`); alert engine sends a push
  on every fired alert (urgent TTL, `requireInteraction`). Optional Telegram: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` →
  sendMessage on each alert. Web side (shell team): `web/public/sw.js` service worker showing the notification with vibrate
  pattern and `requireInteraction: true`, a "Enable push alerts on this device" button, PWA `manifest.webmanifest`.
- Deployment files (lead does these at integration): Dockerfile, docker-compose.yml (app + Caddy auto-HTTPS), systemd/pm2
  alternative, volume for SQLite + Laya cache, docs/DEPLOY.md.

## 14. Change set 3 — Next.js, single process, no containers (supersedes §0 layout, §12 bootstrap and §13.3 deployment files)

- `web/` is a **Next.js 16 App Router** app (plain JS, `.js`/`.jsx`, no TypeScript), React 19. The existing framework-agnostic
  modules in `web/src/**` (chart, layout, replay, panels, api, audio) are kept as-is and mounted from React:
  - `web/app/layout.jsx` (html/body, metadata, manifest link, global CSS imports: `../src/styles/*.css`),
  - `web/app/page.jsx` = `'use client'` component that on mount does `const { mountApp } = await import('../src/main.js')`
    and calls `mountApp(rootEl)`; returns a cleanup. No SSR of chart code (everything touching window/canvas loads in effects).
  - `web/next.config.mjs`: `reactStrictMode: false` (avoid double mount of imperative charts), `output` default,
    transpile `lightweight-charts`/`monaco-editor` if needed. Monaco: load via dynamic `import('monaco-editor')` in the browser
    only, with workers created by `new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {type:'module'})`
    in `self.MonacoEnvironment.getWorker`; import Monaco CSS in layout if required. If Monaco cannot be bundled cleanly, fall back
    to loading it from `https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs` via its AMD loader.
  - `web/public/*` (sw.js, manifest, icons) served by Next as static files.
  - `web/index.html` and `web/vite.config.js` are removed (vite stays only as a devDependency for `web/test` demo pages).
- **One process, one port** (`PORT`, default 3000): `server/src/index.js` creates Fastify AND the Next request handler
  (`import next from 'next'; const nextApp = next({ dev: !production, dir: <abs path to web> }); await nextApp.prepare();
  const handle = nextApp.getRequestHandler();`) and registers a catch-all `app.all('/*')` (after all /api and /ws routes) that
  does `reply.hijack(); handle(req.raw, reply.raw)`. WebSocket upgrades for `/ws` go to @fastify/websocket; other upgrade
  requests (Next dev HMR `/_next/webpack-hmr`) must be passed to `nextApp.getUpgradeHandler()` in dev. Same-origin means
  no CORS and the auth cookie just works.
- Scripts: root `npm run dev` → server in dev (Next dev inside), `npm run build` → `next build` in web, `npm start` →
  production server (serves the built Next app). No Docker/Caddy. 24/7 hosting = `pm2 start npm --name tradeview -- start`
  (or systemd) on the user's machine/VPS, documented in docs/DEPLOY.md.
