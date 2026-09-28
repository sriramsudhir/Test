import { formatCountdown } from './format.js';

const EMPTY = Object.freeze([]);

class CountdownAxisView {
  constructor(p) {
    this._p = p;
  }
  coordinate() {
    return this._p._y;
  }
  text() {
    return this._p._text;
  }
  textColor() {
    return '#ffffff';
  }
  backColor() {
    return this._p._color;
  }
  visible() {
    return this._p._visible;
  }
  tickVisible() {
    return false;
  }
}

/**
 * Time-to-bar-close label shown on the price axis just under the last-price label (TradingView style).
 * getState() → { price, closeTime, up } | null
 */
export class CountdownPrimitive {
  constructor(getState) {
    this._getState = getState;
    this._views = [new CountdownAxisView(this)];
    this._y = 0;
    this._text = '';
    this._color = '#26a69a';
    this._visible = false;
    this._series = null;
    this._req = null;
    this._timer = null;
    this.enabled = true;
  }

  attached({ series, requestUpdate }) {
    this._series = series;
    this._req = requestUpdate;
    this._timer = setInterval(() => this._req?.(), 1000);
  }

  detached() {
    clearInterval(this._timer);
    this._series = null;
    this._req = null;
  }

  updateAllViews() {
    const s = this.enabled && this._series ? this._getState() : null;
    if (!s) {
      this._visible = false;
      return;
    }
    const y = this._series.priceToCoordinate(s.price);
    if (y == null) {
      this._visible = false;
      return;
    }
    this._visible = true;
    this._y = y + 17;
    this._text = formatCountdown(s.closeTime - Date.now());
    this._color = s.up ? '#26a69a' : '#ef5350';
  }

  priceAxisViews() {
    return this._visible ? this._views : EMPTY;
  }
}
