# TradeView build roadmap

The scheduled "TradeView continue build" routine reads this file to see what's left.
Tick items off as they land on branch `claude/tradingview-clone-bybit-vlgtuj`.

## Phase 1: core build (parallel subagents)
- [ ] Server data: Bybit REST/WS, SQLite, backfill (365d, all tfs), footprint from trade dumps, REST + WS API
- [ ] Server intelligence: PineTS runner + library, backtest engine, alert engine + Laya gate, Claude agent
- [ ] Web chart core: ChartView, chart types incl. footprint, drawings, indicators, multi-layout, bar replay + paper trading
- [ ] Web app shell: panels (watchlist, alerts, chat agent, Pine editor, strategy tester, replay trading), loud alarms

## Phase 2: integration
- [ ] Wire everything; `npm run build` and `npm test` pass
- [ ] End-to-end smoke test with a mock Bybit feed (headless browser): chart loads, agent draws, alert fires with sound
- [ ] README complete; commit and push

## Phase 3: hardening
- [ ] Code review pass (correctness), fix findings
- [ ] Performance: 1m history over 1 year per symbol (≈525k bars) loads in pages; footprint rendering at zoom-out
- [ ] Docker image (server serves built web)
