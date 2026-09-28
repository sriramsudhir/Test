import { ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';

/** TradingView dark palette. */
export const THEME = {
  bg: '#131722',
  panel: '#1e222d',
  panel2: '#2a2e39',
  grid: '#2a2e39',
  gridSoft: 'rgba(42, 46, 57, 0.6)',
  border: '#2a2e39',
  text: '#d1d4dc',
  textStrong: '#f0f3fa',
  muted: '#787b86',
  accent: '#2962ff',
  up: '#26a69a',
  down: '#ef5350',
  upAlpha: 'rgba(38, 166, 154, 0.5)',
  downAlpha: 'rgba(239, 83, 80, 0.5)',
  crosshair: '#9598a1',
  crosshairLabel: '#363a45',
  poc: '#f5c542',
  warn: '#ff9800',
  font: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  mono: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

/** Default colours cycled for indicator plots that do not specify one. */
export const PLOT_PALETTE = ['#2962ff', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#4caf50', '#f44336', '#9c27b0', '#8bc34a', '#ff5722'];

/** Colour choices offered for drawings. */
export const DRAWING_COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#d1d4dc', '#787b86', '#ffffff'];

export function chartOptions() {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: THEME.bg },
      textColor: THEME.muted,
      fontSize: 11,
      fontFamily: THEME.font,
      attributionLogo: false,
      panes: { separatorColor: THEME.border, separatorHoverColor: 'rgba(41, 98, 255, 0.35)', enableResize: true },
    },
    grid: {
      vertLines: { color: THEME.gridSoft },
      horzLines: { color: THEME.gridSoft },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: THEME.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: THEME.crosshairLabel },
      horzLine: { color: THEME.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: THEME.crosshairLabel },
    },
    rightPriceScale: {
      borderColor: THEME.border,
      scaleMargins: { top: 0.08, bottom: 0.08 },
      textColor: THEME.text,
      minimumWidth: 64,
    },
    leftPriceScale: { visible: false, borderColor: THEME.border },
    timeScale: {
      borderColor: THEME.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 8,
      barSpacing: 7,
      minBarSpacing: 0.5,
      shiftVisibleRangeOnNewBar: true,
    },
    localization: { locale: 'en-US' },
    handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    kineticScroll: { mouse: false, touch: true },
  };
}

/** Convert a CSS hex colour to rgba(). */
export function withAlpha(color, alpha) {
  if (!color) return `rgba(41,98,255,${alpha})`;
  if (color.startsWith('rgba')) return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3,${alpha})`);
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  let h = color.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return color;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
