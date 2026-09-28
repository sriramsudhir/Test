# TradeView

A self-hosted, TradingView-style charting and trading-research platform that you run on your own machine or VPS.
It is written in plain JavaScript (ESM): a Fastify server with an in-process Next.js web app, in one process on one port.

- **Market data**: Delta Exchange is the primary provider and Bybit is the second. Candles for every timeframe are
  stored in a local SQLite database, and live updates arrive over WebSocket.
- **Charts** (lightweight-charts v5): candles, bars, line, area, Heikin Ashi, footprint, Renko and range. Drawing
  tools, multi-chart layouts (1, 2, 3, 4, 6 or 8 charts) with synced crosshair, symbol and interval, and bar replay
  with paper trading.
- **Pine Script** through PineTS: a built-in indicator library plus your own scripts in a Monaco editor.
- **Strategy tester**: backtests Pine `strategy()` scripts or built-in JS strategies, and reports net profit, win rate,
  profit factor, drawdown, Sharpe, Sortino and more.
- **Alerts** run on the server 24/7, so they fire even when no tab is open. Conditions can be price, indicator or
  drawing based. A loud in-browser alarm plays when one fires, and Web Push and optional Telegram notifications are
  sent. An optional **Laya** decision gate asks a small local model whether a breakout is likely to continue before
  the alert fires.
- **Claude agent** in a chat panel. It can read candles, run Pine, run backtests, draw on the chart, change the
  layout and create alerts. It runs on your **Claude Pro/Max subscription** through the Claude Agent SDK, so no API
  key is needed.
- **Site login**: password-protected cookie sessions, so the app can be exposed to the internet.

## Requirements

- Node.js 20 or newer (22 recommended)
- About 1–2 GB of disk for a year of candles on the default symbols. The optional local Laya model needs about
  1.7 GB more.

## Setup

```bash
npm install
cp .env.example .env          # optional: every value has a default; set AUTH_PASSWORD before exposing the port
npm run backfill -- --symbols default --days 365
npm run dev
```

Then open **http://localhost:3000**. The API, the `/ws` WebSocket and the web app share that port.

- `npm run dev` starts the server with the Next.js dev server inside it (hot reload).
- `npm run build` builds the web app, and `npm start` runs the production server, which serves that build.
- `node server/src/index.js --no-web` (or `WEB=off`) starts the API alone.
- `npm test` runs the server unit tests. They are offline and use fixtures instead of network access.

Next.js allows only one dev server per `web/` folder. If another `next dev` is already running on this checkout,
stop it first.

### Running 24/7 (no Docker)

```bash
npm run build && pm2 start npm --name tradeview -- start
pm2 save && pm2 startup       # restart on reboot
```

A systemd unit works just as well. When exposing TradeView to the internet:

1. Set `AUTH_PASSWORD` (or `AUTH_PASSWORD_HASH`) and `SESSION_SECRET`.
2. Put it behind HTTPS, for example a reverse proxy with automatic certificates.
3. When a proxy is in front, set `TRUST_PROXY=true`. This lets the login rate limit see real client IPs and makes
   cookies `Secure`.

If no password is set, the server logs a loud warning at startup and runs without login.

## Backfill

```bash
npm run backfill -- --symbols default --days 365 --tf all
npm run backfill -- --symbols delta:BTCUSD,delta:ETHUSD,linear:BTCUSDT --tf 1m,5m,1h,1D
npm run backfill -- --symbols delta:top:10 --days 90
npm run backfill -- --symbols linear:BTCUSDT --footprint     # Bybit footprint history from trade dumps
```

| flag | meaning |
|---|---|
| `--symbols` | Comma list. It accepts symbol keys (`delta:BTCUSD`, `linear:BTCUSDT`, `spot:ETHUSDT`); `delta` (all Delta perpetuals); `delta:top:N`; `top:N` (Bybit linear USDT perpetuals by turnover); Bybit groups `crypto`, `forex`, `commodities`; and `default` (`DEFAULT_SYMBOLS`). |
| `--days` | History depth (default 365) |
| `--tf` | `all` (13 timeframes: 1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1D 1W 1M) or a comma list |
| `--footprint` | Also build 1m–1h footprint history from `public.bybit.com` daily trade dumps (Bybit symbols only) |
| `--concurrency` | Symbols fetched in parallel (default 2). All requests share one rate limiter per provider. |

Backfill is resumable. Progress is stored per symbol and timeframe in the database, so an interrupted run continues
where it stopped, and later runs only fetch what is new. The server also fills gaps on startup and after a
WebSocket reconnect.

## Data notes

**Symbol keys.** Every symbol is written as `provider-category:SYMBOL`, for example `delta:BTCUSD`,
`linear:BTCUSDT`, `spot:ETHUSDT` or `inverse:BTCUSD`. `/api/symbols` lists both providers, and each row carries
`provider: "delta" | "bybit"`.

**Delta Exchange (primary).**
- Uses the public REST API (`api.india.delta.exchange` by default, or `DELTA_REGION=global` for
  `api.delta.exchange`) and the public WebSocket. No API key is needed for market data.
  `DELTA_API_KEY`/`DELTA_API_SECRET` are placeholders only.
- Native resolutions are served directly. TradeView builds the rest itself:
  - 12h is built from 6h.
  - Weekly and monthly bars are built from daily bars, so weeks open on Monday 00:00 UTC and months on the 1st.
  - Seconds charts (1s/5s/15s/30s) are built from live trades.
- Delta publishes no historical trade dumps, so the server **records live trades 24/7** for every `RECORD_SYMBOLS`
  entry (default: the default symbols). Those trades go into footprint bars (1m–1h) and a raw `trades` table, which
  is pruned after `TRADES_RETENTION_DAYS` (default 30). Footprint history for Delta therefore builds up from the
  first time the server starts.
- Delta's exact response schemas could not be verified against the live API while this was written. The client
  parses them defensively, and logs and skips any row it does not understand.

**Bybit (second provider).**
- Bybit's public API only lists the instruments Bybit actually trades, which is mostly crypto. The **forex** and
  **commodities** watchlist groups are therefore just whatever FX- or commodity-linked instruments Bybit returns,
  for example gold tokens such as `XAUTUSDT`/`PAXGUSDT` or fiat spot pairs such as `EURUSDT`. They are not a real
  FX or futures feed.
- Bybit footprint history comes from Bybit's public daily trade dumps at `public.bybit.com`
  (`npm run backfill -- --footprint`).

**Offline.** If a provider is unreachable, the app keeps working from the SQLite cache and shows a status badge.
`/api/health` reports each provider separately.

## Claude agent

The default is `AGENT_DRIVER=claude-code`, which uses `@anthropic-ai/claude-agent-sdk` with your Claude Pro/Max
subscription. Authenticate the machine that runs the server in one of two ways:

- Run `claude` once and use `/login`, or
- Run `claude setup-token` and put the token in `CLAUDE_CODE_OAUTH_TOKEN`.

If `ANTHROPIC_API_KEY` is set, the SDK uses the API key instead of your subscription.
`AGENT_DRIVER=anthropic-api` uses the Messages API directly with `ANTHROPIC_API_KEY`, and `AGENT_DRIVER=off`
disables the agent. `GET /api/agent/status` shows which driver is active and whether it is ready.

Alerts never depend on Claude. The alert engine and Laya keep running when Claude is unavailable or rate limited.

## Laya (alert decision gate)

- **Local (default, `LAYA_MODE=local`)**: runs `@receptron/laya` with ONNX inside the server. The model (about
  1.7 GB) downloads automatically from Hugging Face the first time it is used, then is cached.
- **HTTP (`LAYA_MODE=http`)**: run the Python server and point TradeView at it:
  ```bash
  pip install "laya[serve]"
  laya-serve                    # then set LAYA_MODE=http and LAYA_URL=http://127.0.0.1:8000
  ```
- **Off (`LAYA_MODE=off`)**: alerts fire without the gate.

If Laya is unavailable, alerts still fire, and the event is marked with `laya: { skipped: true }`.

## Notifications

- **Web Push**: VAPID keys are generated on first start and stored in the database. Click "Enable push alerts on
  this device" in the app. Set `VAPID_SUBJECT` to a `mailto:` address.
- **Telegram**: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Testing

```bash
npm test                 # server unit tests (offline, fixtures only)
npm run e2e              # end-to-end: real server + fake exchange + Chromium
npm run e2e -- --prod    # the same against the production build (run `npm run build` first)
npm run e2e:fake         # just the fake Delta Exchange (REST + WS on :8790) and fake laya-serve (:8791)
```

`npm run e2e` (`web/test/e2e/run.mjs`) needs no network access. It:

1. starts a local fake Delta Exchange (`web/test/e2e/fake-delta.mjs`) and a fake `laya-serve`
   (`web/test/e2e/fake-laya.mjs`) on free ports,
2. runs the real `npm run backfill -- --symbols delta:BTCUSD --days 30 --tf all` against the fake into a temporary
   database,
3. boots the real server (`npm run dev`, or `npm start` with `--prod`) with `AUTH_PASSWORD=test123`,
   `AGENT_DRIVER=off` and `LAYA_MODE=http`,
4. drives Chromium through login, live candles, every timeframe kind (native, derived 12h/1W/1M, seconds), footprint,
   symbol search, a Pine library indicator, the Pine Editor, a Strategy Tester backtest, a Laya-rejected and a
   Laya-approved alert that fires end to end, drawings surviving a reload, the 4-chart layout and bar replay with
   paper trading. It fails on any console or page error.

Screenshots are written to `web/test/screenshots/e2e-*.png`. Options: `--only backfill,login,alert-laya-fire` runs a subset of steps (names as printed),
`E2E_KEEP=1` leaves the server and fakes running afterwards. Playwright is not a project dependency: install it with
`npm i -g playwright && npx playwright install chromium` (or point `PLAYWRIGHT_BROWSERS_PATH` at existing browsers).

The fake exchange serves a deterministic year of 1m history for BTCUSD, ETHUSD and SOLUSD (plus XRP/BNB/DOGE), builds
every other resolution from it, and streams random-walk trades several times per second over Delta's WebSocket
protocol (`candlestick_*`, `all_trades`). Test control endpoints: `POST /control/price {symbol, price, pause?}` prints
a trade at a forced price, `POST /control/pause {paused}` freezes the walk, `GET /control/state`. The fake Laya answers
`POST /v1/systemone` and takes `POST /control/laya {p}` to set the decision probability. To point a normal server at
them: `DELTA_REST=http://127.0.0.1:8790 DELTA_WS=ws://127.0.0.1:8790 LAYA_MODE=http LAYA_URL=http://127.0.0.1:8791`.

## Architecture

```
tradeview/
  server/src/
    index.js          one process: Fastify (API + /ws) + Next.js request handler
    config.js         .env -> config (secrets are non-enumerable, never logged)
    auth/             site login (scrypt password, signed cookie, rate limit)
    db/               SQLite (WAL) schema + repositories
    providers/        provider router by symbol prefix (delta:* / linear:|spot:|inverse:*)
    delta/            Delta Exchange REST + WS clients (primary)
    bybit/            Bybit REST + WS clients, instrument catalogue, market groups
    data/             timeframes, aggregation, footprint, MarketData, LiveHub, recorder, backfill, gap fill
    api/              REST routes + WebSocket gateway
    pine/ backtest/ alerts/ laya/ agent/ notify/
  server/scripts/backfill.js
  web/                Next.js App Router shell mounting the chart app (web/src)
```

The contracts between modules are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: REST and WebSocket messages,
the data model, and module interfaces.

## Configuration

All settings are environment variables and are documented in [.env.example](.env.example). The most important ones:

| variable | default | purpose |
|---|---|---|
| `PORT` | 3000 | single port for API, `/ws` and web app |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_HASH`, `SESSION_SECRET` | – | site login |
| `DELTA_REGION` | india | `india` or `global` Delta endpoints |
| `DEFAULT_SYMBOLS` | Delta majors | watchlist and backfill default |
| `RECORD_SYMBOLS` | = default symbols | 24/7 trade recording for footprint |
| `TRADES_RETENTION_DAYS` | 30 | raw trade retention |
| `FOOTPRINT_RETENTION_DAYS` | 90 | recorded 1m/3m/5m footprint retention (15m–1h kept; 0 = keep all) |
| `ALERT_EVENTS_MAX` | 10000 | fired-alert history kept (newest first) |
| `LAYA_GATE_TIMEOUT_MS` | 30000 | an alert waits at most this long for Laya, then fires as "Laya skipped" |
| `AGENT_DRIVER` | claude-code | `claude-code`, `anthropic-api` or `off` |
| `LAYA_MODE` | local | `local`, `http` or `off` |
| `DB_PATH` | ./data/tradeview.db | SQLite file |
