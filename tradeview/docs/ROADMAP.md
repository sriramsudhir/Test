# TradeView build roadmap

The scheduled "TradeView continue build" routine reads this file to see what's left.
Tick items off as they land on branch `claude/tradingview-clone-bybit-vlgtuj`.

## Phase 1: core build (parallel subagents)
- [ ] Server data: Bybit REST/WS, SQLite, backfill (365d, all tfs), footprint from trade dumps, REST + WS API
- [x] Server intelligence: PineTS runner + library, backtest engine, alert engine + Laya gate, Claude agent
- [ ] Web chart core: ChartView, chart types incl. footprint, drawings, indicators, multi-layout, bar replay + paper trading
- [ ] Web app shell: panels (watchlist, alerts, chat agent, Pine editor, strategy tester, replay trading), loud alarms

## Phase 1b: change set 2 (ARCHITECTURE §13)
- [ ] Delta Exchange primary provider + 24/7 trade recording for footprint
- [x] Claude Code subscription driver (Agent SDK, CLAUDE_CODE_OAUTH_TOKEN), agent status
- [ ] Site login, Web Push + Telegram alerts, PWA service worker

## Phase 1c: Next.js (ARCHITECTURE §14)
- [ ] web/ as Next.js App Router mounting existing modules; single-process server with Next handler

## Phase 2: integration
- [ ] Wire everything; `npm run build` and `npm test` pass
- [ ] End-to-end smoke test with a mock Bybit feed (headless browser): chart loads, agent draws, alert fires with sound
- [ ] README complete; commit and push

## Phase 3: hardening
- [ ] Code review pass (correctness), fix findings
- [ ] Performance: 1m history over 1 year per symbol (≈525k bars) loads in pages; footprint rendering at zoom-out
- [ ] docs/DEPLOY.md: run 24/7 with pm2/systemd, HTTPS options, `claude setup-token` (no containers)
