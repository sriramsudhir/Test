// Chart-core demo (mock data). Exposes window.layout / window.mock for the Playwright smoke test.
import '../src/styles/chart.css';
import { Layout } from '../src/layout/Layout.js';
import * as mock from './mock-client.js';

const layout = new Layout(document.getElementById('app'), { persist: false, symbol: 'delta:BTCUSD', tf: '1h' });
window.layout = layout;
window.mock = mock;
const symbols = ['delta:BTCUSD', 'delta:ETHUSD', 'linear:SOLUSDT'];
layout.on('symbol-search', ({ chart }) => chart.setSymbol(symbols[(symbols.indexOf(chart.symbol) + 1) % symbols.length]));
layout.on('open-indicators', ({ chart }) => chart.addIndicator({ builtin: 'ema', inputs: { length: 50 } }));
layout.on('alertmove', (e) => (window.lastAlertMove = e));
layout.on('priceclick', (e) => (window.lastPriceClick = e));
