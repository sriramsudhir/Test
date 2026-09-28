// Object tree: indicators and drawings of the active chart, with hide/show and remove.
import { h, clear, icon, iconButton } from './util/dom.js';
import { toast, confirmDialog } from './util/dialog.js';
import { chartState, chartDrawings, chartIndicators } from './util/chartHub.js';
import { splitKey, formatPrice } from './util/fmt.js';

const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export class ObjectTreePanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.app = app;
    el.classList.add('panel', 'object-tree');
    this.body = h('div.panel-body');
    this.title = h('div.panel-title', 'Object tree');
    el.append(h('div.panel-header', this.title, h('div.panel-actions', iconButton('refresh', 'Refresh', () => this.render()))), this.body);
    const rerender = () => this.scheduleRender();
    for (const ev of ['active', 'charts', 'symbol', 'drawing', 'indicator', 'indicators', 'chartType']) app.hub.on(ev, rerender);
    // Indicators may not emit events: poll lightly while the panel is visible.
    this.timer = setInterval(() => { if (this.el.offsetParent) this.render(); }, 2500);
    this.render();
  }

  destroy() { clearInterval(this.timer); }

  scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); });
  }

  render() {
    const chart = this.app.hub.active;
    clear(this.body);
    if (!chart) { this.body.appendChild(h('div.empty', 'No active chart')); return; }
    const st = chartState(chart);
    const inds = chartIndicators(chart);
    const draws = chartDrawings(chart);
    this.title.textContent = `Object tree · ${splitKey(st.symbol).symbol} ${st.tf || ''}`;

    this.body.appendChild(h('div.tree-group', icon('data', 14), h('span', 'Main series'), h('span.muted', pretty(st.chartType || 'candles'))));

    const indHead = h('div.tree-head', h('span', `Indicators (${inds.length})`), h('span.spacer'),
      inds.length ? h('button.btn.btn-ghost.btn-xs', { type: 'button', onclick: async () => {
        if (await confirmDialog(`Remove all ${inds.length} indicators?`, { danger: true, okLabel: 'Remove' })) {
          for (const i of inds) try { chart.removeIndicator(i.id); } catch { /* ignore */ }
          this.render();
        }
      } }, 'Remove all') : null);
    this.body.appendChild(indHead);
    if (!inds.length) this.body.appendChild(h('div.tree-empty', 'No indicators. Use the toolbar, the Pine Editor or ask the agent.'));
    for (const ind of inds) {
      const hidden = ind.visible === false || ind.hidden === true;
      const name = ind.title || ind.name || ind.shorttitle || ind.builtin || ind.id;
      const detail = ind.inputs && typeof ind.inputs === 'object' ? Object.values(ind.inputs).slice(0, 4).join(', ') : '';
      this.body.appendChild(this.row({
        ico: 'code',
        label: name,
        detail: detail || (ind.overlay === false ? 'pane' : ind.pane != null ? `pane ${ind.pane}` : ''),
        hidden,
        onToggle: () => this.setIndicatorVisible(chart, ind, hidden),
        onRemove: () => { try { chart.removeIndicator(ind.id); } catch (err) { toast(err.message, 'error'); } this.render(); },
      }));
    }

    const drawHead = h('div.tree-head', h('span', `Drawings (${draws.length})`), h('span.spacer'),
      draws.length ? h('button.btn.btn-ghost.btn-xs', { type: 'button', onclick: async () => {
        if (await confirmDialog(`Remove all ${draws.length} drawings on ${splitKey(st.symbol).symbol}?`, { danger: true, okLabel: 'Remove' })) {
          try { chart.clearDrawings(); } catch (err) { toast(err.message, 'error'); }
          this.render();
        }
      } }, 'Remove all') : null);
    this.body.appendChild(drawHead);
    if (!draws.length) this.body.appendChild(h('div.tree-empty', 'No drawings on this symbol.'));
    for (const d of draws) {
      const hidden = d.hidden === true || d.visible === false;
      const p0 = d.points && d.points[0];
      this.body.appendChild(this.row({
        ico: 'edit',
        label: d.name || (d.style && d.style.text && d.type === 'text' ? `“${d.style.text}”` : pretty(d.type)),
        detail: p0 ? formatPrice(p0.price) : '',
        hidden,
        badge: d.createdBy === 'agent' ? 'AI' : null,
        onToggle: () => this.setDrawingVisible(chart, d, hidden),
        onRemove: () => { try { chart.removeDrawing(d.id); } catch (err) { toast(err.message, 'error'); } this.render(); },
      }));
    }
  }

  row({ ico, label, detail, hidden, badge, onToggle, onRemove }) {
    return h(`div.tree-row${hidden ? '.hidden' : ''}`,
      icon(ico, 14),
      h('span.tree-label', { title: label }, label),
      badge ? h('span.chip.chip-agent', badge) : null,
      detail ? h('span.tree-detail', detail) : null,
      h('span.spacer'),
      iconButton(hidden ? 'eyeOff' : 'eye', hidden ? 'Show' : 'Hide', () => { onToggle(); this.render(); }, 'sm'),
      iconButton('trash', 'Remove', onRemove, 'sm'));
  }

  setIndicatorVisible(chart, ind, visible) {
    const candidates = [
      () => chart.setIndicatorVisible(ind.id, visible),
      () => chart.setIndicatorVisibility(ind.id, visible),
      () => chart.updateIndicator(ind.id, { visible }),
      () => (visible ? chart.showIndicator(ind.id) : chart.hideIndicator(ind.id)),
      () => chart.indicators.setVisible(ind.id, visible),
    ];
    if (!tryFirst(candidates)) toast('This chart does not support hiding indicators', 'warn');
  }

  setDrawingVisible(chart, d, visible) {
    const candidates = [
      () => chart.setDrawingVisible(d.id, visible),
      () => chart.updateDrawing(d.id, { hidden: !visible }),
      () => chart.drawings.update(d.id, { hidden: !visible }),
    ];
    if (!tryFirst(candidates)) toast('This chart does not support hiding drawings', 'warn');
  }
}

function tryFirst(fns) {
  for (const fn of fns) {
    try { fn(); return true; } catch (err) { if (!(err instanceof TypeError)) { toast(err.message, 'error'); return true; } }
  }
  return false;
}
