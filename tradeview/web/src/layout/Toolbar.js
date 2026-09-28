import { ICONS, layoutIcon } from './icons.js';
import { showMenu, closeMenu, menuItem, menuHeader, menuSep } from './menu.js';
import { TIMEFRAMES, TF_GROUP_LABELS, tfLabel } from '../chart/timeframes.js';
import { CHART_TYPES } from '../chart/ChartView.js';
import { el, escapeHtml } from '../chart/util.js';

const FAV_KEY = 'tv.favTimeframes';
const DEFAULT_FAVS = ['1m', '5m', '15m', '1h', '4h', '1D'];
export const LAYOUT_IDS = ['1', '2h', '2v', '3', '4', '6', '8'];
const LAYOUT_LABELS = { 1: '1 chart', '2h': '2 charts, side by side', '2v': '2 charts, stacked', 3: '3 charts', 4: '4 charts', 6: '6 charts', 8: '8 charts' };

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch { /* storage unavailable */ }
  return DEFAULT_FAVS.slice();
}

function saveFavs(f) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(f));
  } catch { /* ignore */ }
}

/**
 * Top toolbar for the active chart of a Layout: symbol, timeframes, chart type, indicators, VPVR, layout,
 * replay, screenshot, fullscreen. Emits (through the layout): 'symbol-search', 'open-indicators', 'screenshot'.
 */
export class Toolbar {
  /** @param {HTMLElement} host  @param {import('./Layout.js').Layout} layout */
  constructor(host, layout) {
    this.layout = layout;
    this.favs = loadFavs();
    this.root = el('div', { class: 'tv-toolbar' });
    host.append(this.root);
    this._build();
    this._chartOffs = [];
    this._offs = [
      layout.on('active', () => this._bindActive()),
      layout.on('layout', () => this._renderLayoutBtn()),
    ];
    this._bindActive();
  }

  destroy() {
    for (const off of [...this._offs, ...this._chartOffs]) off();
    closeMenu();
    this.root.remove();
  }

  get chart() {
    return this.layout.active;
  }

  _btn(cls, title, html, onclick) {
    return el('button', { class: `tv-tb-btn ${cls}`, title, html, onclick });
  }

  _build() {
    const r = this.root;
    this.symBtn = this._btn('tv-tb-symbol', 'Symbol search', '', () => this.layout.emit('symbol-search', { chart: this.chart, chartId: this.chart?.id }));
    this.tfFavs = el('div', { class: 'tv-tb-tfs' });
    this.tfMore = this._btn('tv-tb-more', 'All timeframes', ICONS.chevron_down, () => this._tfMenu());
    this.typeBtn = this._btn('tv-tb-type', 'Chart type', '', () => this._typeMenu());
    this.indBtn = this._btn('tv-tb-ind', 'Indicators', `${ICONS.indicators}<span>Indicators</span>`, () => this.layout.emit('open-indicators', { chart: this.chart, chartId: this.chart?.id }));
    this.vpBtn = this._btn('tv-tb-vp', 'Volume profile (visible range)', ICONS.vpvr, () => {
      const c = this.chart;
      if (c) c.setVolumeProfile(!c.volumeProfileEnabled);
      this._renderState();
    });
    this.layoutBtn = this._btn('tv-tb-layout', 'Select layout', '', () => this._layoutMenu());
    this.replayBtn = this._btn('tv-tb-replay', 'Bar replay', `${ICONS.replay}<span>Replay</span>`, () => {
      const c = this.chart;
      if (!c) return;
      if (c.replay.active || c.replay.selecting) c.replay.stop();
      else c.replay.select();
    });
    this.shotBtn = this._btn('tv-tb-shot', 'Take a snapshot', ICONS.camera, () => {
      const c = this.chart;
      if (!c) return;
      const canvas = c.downloadScreenshot();
      this.layout.emit('screenshot', { chart: c, canvas });
    });
    this.fsBtn = this._btn('tv-tb-fs', 'Fullscreen mode', ICONS.fullscreen, () => this.layout.toggleFullscreen());
    const sep = () => el('span', { class: 'tv-tb-sep' });
    r.append(
      this.symBtn,
      sep(),
      this.tfFavs,
      this.tfMore,
      sep(),
      this.typeBtn,
      sep(),
      this.indBtn,
      this.vpBtn,
      sep(),
      this.layoutBtn,
      sep(),
      this.replayBtn,
      el('span', { class: 'tv-tb-spacer' }),
      this.shotBtn,
      this.fsBtn,
    );
  }

  _bindActive() {
    for (const off of this._chartOffs) off();
    this._chartOffs = [];
    const c = this.chart;
    if (c) {
      for (const ev of ['symbol', 'tf', 'charttype', 'replay', 'vpvr']) this._chartOffs.push(c.on(ev, () => this._renderState()));
    }
    this._renderState();
  }

  _renderState() {
    const c = this.chart;
    if (!c) return;
    const bare = c.symbol.includes(':') ? c.symbol.split(':')[1] : c.symbol;
    this.symBtn.innerHTML = `${ICONS.search}<span class="tv-tb-symname">${escapeHtml(bare)}</span>`;
    this.tfFavs.innerHTML = '';
    const favs = this.favs.includes(c.tf) ? this.favs : [...this.favs];
    for (const tf of favs) {
      this.tfFavs.append(el('button', { class: `tv-tb-tf${tf === c.tf ? ' tv-active' : ''}`, text: tfLabel(tf), title: TIMEFRAMES.find((t) => t.id === tf)?.label, onclick: () => c.setTimeframe(tf) }));
    }
    if (!this.favs.includes(c.tf)) this.tfFavs.append(el('button', { class: 'tv-tb-tf tv-active', text: tfLabel(c.tf) }));
    this.typeBtn.innerHTML = ICONS[c.chartType] || ICONS.candles;
    this.typeBtn.title = `Chart type: ${CHART_TYPES.find((t) => t.id === c.chartType)?.label}`;
    this.vpBtn.classList.toggle('tv-active', c.volumeProfileEnabled);
    this.replayBtn.classList.toggle('tv-active', c.replay.active || c.replay.selecting);
    this._renderLayoutBtn();
  }

  _renderLayoutBtn() {
    this.layoutBtn.innerHTML = `${layoutIcon(this.layout.layoutId)}${ICONS.chevron_down}`;
  }

  _tfMenu() {
    const c = this.chart;
    showMenu(this.tfMore, (m, close) => {
      m.classList.add('tv-menu-tf');
      let group = null;
      for (const tf of TIMEFRAMES) {
        if (tf.group !== group) {
          group = tf.group;
          m.append(menuHeader(TF_GROUP_LABELS[group]));
        }
        const fav = this.favs.includes(tf.id);
        const star = el('span', { class: `tv-fav${fav ? ' tv-on' : ''}`, title: fav ? 'Remove from favorites' : 'Add to favorites', html: fav ? ICONS.star_filled : ICONS.star });
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          const i = this.favs.indexOf(tf.id);
          if (i >= 0) this.favs.splice(i, 1);
          else {
            this.favs.push(tf.id);
            this.favs.sort((a, b) => TIMEFRAMES.findIndex((t) => t.id === a) - TIMEFRAMES.findIndex((t) => t.id === b));
          }
          saveFavs(this.favs);
          star.classList.toggle('tv-on');
          star.innerHTML = star.classList.contains('tv-on') ? ICONS.star_filled : ICONS.star;
          this._renderState();
        });
        m.append(menuItem({ label: tf.label, active: tf.id === c.tf, right: star, onclick: () => (close(), c.setTimeframe(tf.id)) }));
      }
    });
  }

  _typeMenu() {
    const c = this.chart;
    showMenu(this.typeBtn, (m, close) => {
      for (const t of CHART_TYPES) {
        m.append(menuItem({ icon: ICONS[t.id], label: t.label, active: t.id === c.chartType, onclick: () => (close(), c.setChartType(t.id)) }));
      }
      m.append(menuSep());
      if (c.chartType === 'renko') {
        m.append(menuHeader('Renko box'));
        const mode = el('select', { class: 'tv-input' }, [el('option', { value: 'atr', text: 'ATR (14)' }), el('option', { value: 'fixed', text: 'Fixed' })]);
        mode.value = c.options.renko.mode;
        const box = el('input', { class: 'tv-input', type: 'number', step: 'any', placeholder: 'Box size', value: c.options.renko.boxSize ?? '' });
        const apply = () => c.setRenkoOptions({ mode: mode.value, boxSize: +box.value || null });
        mode.addEventListener('change', apply);
        box.addEventListener('change', apply);
        m.append(el('div', { class: 'tv-menu-form' }, [mode, box]));
      } else if (c.chartType === 'range') {
        m.append(menuHeader('Range size (empty = auto)'));
        const rng = el('input', { class: 'tv-input', type: 'number', step: 'any', placeholder: 'auto', value: c.options.range.range ?? '' });
        rng.addEventListener('change', () => c.setRangeOptions({ range: +rng.value || null }));
        m.append(el('div', { class: 'tv-menu-form' }, [rng]));
      } else if (c.chartType === 'footprint') {
        m.append(menuHeader('Footprint'));
        const cur = c.mainSeries.options();
        const modes = [['bidask', 'Bid × Ask'], ['delta', 'Delta'], ['profile', 'Volume profile']];
        for (const [id, label] of modes) m.append(menuItem({ label, active: cur.mode === id, onclick: () => (close(), c.setFootprintOptions({ mode: id })) }));
        const ratio = el('input', { class: 'tv-input', type: 'number', min: '1', step: '0.5', value: cur.imbalanceRatio, title: 'Imbalance ratio' });
        ratio.addEventListener('change', () => c.setFootprintOptions({ imbalanceRatio: +ratio.value || 3 }));
        const imb = el('input', { type: 'checkbox', checked: cur.showImbalance });
        imb.addEventListener('change', () => c.setFootprintOptions({ showImbalance: imb.checked }));
        m.append(el('label', { class: 'tv-menu-form' }, [el('span', { text: 'Imbalance ≥' }), ratio, el('span', { text: 'x' }), imb]));
      }
      const vol = el('input', { type: 'checkbox', checked: c.options.volume });
      vol.addEventListener('change', () => c.setVolumeVisible(vol.checked));
      m.append(el('label', { class: 'tv-menu-check' }, [vol, el('span', { text: 'Volume' })]));
    });
  }

  _layoutMenu() {
    const L = this.layout;
    showMenu(this.layoutBtn, (m, close) => {
      m.classList.add('tv-menu-layout');
      m.append(menuHeader('Layout'));
      const grid = el('div', { class: 'tv-layout-grid' });
      for (const id of LAYOUT_IDS) {
        grid.append(el('button', { class: `tv-layout-opt${L.layoutId === id ? ' tv-active' : ''}`, title: LAYOUT_LABELS[id], html: layoutIcon(id, 30), onclick: () => (close(), L.setLayout(id)) }));
      }
      m.append(grid, menuSep(), menuHeader('Sync in layout'));
      for (const [key, label] of [['syncSymbol', 'Symbol'], ['syncInterval', 'Interval'], ['syncCrosshair', 'Crosshair'], ['syncTime', 'Time']]) {
        const cb = el('input', { type: 'checkbox', checked: !!L[key] });
        cb.addEventListener('change', () => (L[key] = cb.checked));
        m.append(el('label', { class: 'tv-menu-check' }, [cb, el('span', { text: label })]));
      }
    });
  }
}
