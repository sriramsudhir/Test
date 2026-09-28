# Running TradeView 24/7

TradeView is a single Node.js process: it runs the Next.js site, the API, the live WebSocket, the Delta trade recorder
and the alert engine. The alert engine and trade recorder only work while that process is running, so run it on a machine that
stays on: a small VPS, a home server or an always-on PC. No Docker is needed.

## 1. Machine

- Linux, macOS or Windows with **Node.js 20+** (22 LTS recommended).
- **4 GB RAM** or more if you use Laya locally (the model needs about 2 GB), 1 GB otherwise.
- About 5 GB of disk: the Laya model is about 1.7 GB, plus the SQLite database (a year of 1m candles for 6 symbols is a few hundred MB, and recorded
  trades grow with `TRADES_RETENTION_DAYS`).
- If you are in India and use Delta India, host the machine in a region where Delta India's API is reachable.

## 2. Install

```bash
git clone <this repo> && cd <repo>/tradeview
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```ini
AUTH_PASSWORD=choose-a-long-password       # the site is on the internet: always set this
DELTA_REGION=india                         # or global
```

Do **not** put your Delta API key or secret here: market data is public and the app never trades.

## 3. Claude chat with your Claude Pro/Max subscription (no API key)

The chat uses the Claude Agent SDK, which runs through Claude Code and your Claude login.

```bash
npm install -g @anthropic-ai/claude-code   # installs the `claude` CLI
claude setup-token                         # opens the browser: sign in (Google works), approve
```

Copy the printed token into `.env`:

```ini
AGENT_DRIVER=claude-code
CLAUDE_CODE_OAUTH_TOKEN=<token>
```

The token lasts one year. Don't set `ANTHROPIC_API_KEY` at the same time, because it would take precedence over the subscription.
Your subscription's usage limits apply: when you hit one, the chat says so and the alert engine and Laya keep running.
Use your subscription only for your own use of your own site. If other people will use the chat, switch to `AGENT_DRIVER=anthropic-api` with an
API key.

## 4. Laya decision model

The default `LAYA_MODE=local` loads `@receptron/laya` (ONNX Runtime) in-process. It downloads the model from Hugging Face on first use
(about 1.7 GB) into `~/.cache/receptron-laya`; set `LAYA_CACHE` to put it elsewhere. Alternative: run the Python server
(`pip install "laya[serve]" && laya-serve`) and set `LAYA_MODE=http`, `LAYA_URL=http://127.0.0.1:8000`.
If Laya is unavailable, alerts still fire and are marked "Laya skipped".

## 5. History

```bash
npm run backfill -- --symbols default --days 365 --tf all
```

This downloads one year of every timeframe for the default Delta symbols. It can resume if interrupted. Footprint history for Delta builds up from
the moment the server starts recording (`RECORD_SYMBOLS`); Bybit symbols can also use `--footprint` to import trade dumps.

## 6. Run it forever

```bash
npm run build
npm install -g pm2
pm2 start npm --name tradeview -- start
pm2 save && pm2 startup        # restart on reboot (follow the printed command)
pm2 logs tradeview             # logs
```

Or run it as a systemd service (`/etc/systemd/system/tradeview.service`):

```ini
[Unit]
Description=TradeView
After=network-online.target

[Service]
WorkingDirectory=/opt/tradeview/tradeview
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=tradeview
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now tradeview`.

## 7. HTTPS and a domain

Browsers only allow push notifications and service workers over HTTPS (or on localhost). Put a reverse proxy in front of it, for example:

- **Caddy** (automatic certificates), `/etc/caddy/Caddyfile`:
  ```
  trade.example.com {
      reverse_proxy 127.0.0.1:3000
  }
  ```
- or **nginx** with certbot, proxying `/` and upgrading WebSockets on `/ws`.
- or **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:3000`) with no open ports at all.

Set `TRUST_PROXY=true` in `.env` when behind a proxy, so secure cookies and client IPs work.

## 8. Alerts reaching you when no tab is open

- Open the site on your phone, sign in, then Alerts → **Enable push alerts on this device**. On iPhone, first use
  Share → *Add to Home Screen* and open it from there.
- Optional Telegram: create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- The loud siren plays in any open TradeView tab. Click anywhere once after loading so the browser allows sound.

## 9. Updating

```bash
git pull && npm install && npm run build && pm2 restart tradeview
```
