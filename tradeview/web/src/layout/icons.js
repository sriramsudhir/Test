/** Inline SVG icons (28×28 grid, stroke = currentColor), TradingView-like line style. */

const svg = (body, size = 28, vb = 28) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="1.8" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  cursor: svg('<path d="M14 5v18M5 14h18"/>'),
  trendline: svg(`<path d="M7 21L21 7"/>${dot(7, 21)}${dot(21, 7)}`),
  ray: svg(`<path d="M7 21L24 4"/>${dot(7, 21)}${dot(13, 15)}`),
  extended_line: svg(`<path d="M3 25L25 3"/>${dot(10, 18)}${dot(18, 10)}`),
  horizontal_line: svg(`<path d="M3 14h22"/>${dot(14, 14)}`),
  horizontal_ray: svg(`<path d="M8 14h17"/>${dot(8, 14)}`),
  vertical_line: svg(`<path d="M14 3v22"/>${dot(14, 14)}`),
  parallel_channel: svg(`<path d="M4 18L18 6M10 23L24 11"/>${dot(4, 18)}${dot(18, 6)}${dot(17, 17)}`),
  rectangle: svg(`<rect x="6" y="8" width="16" height="12"/>${dot(6, 8)}${dot(22, 20)}`),
  fib_retracement: svg(`<path d="M4 6h20M4 11h20M4 15h20M4 19h20M4 23h20"/><path d="M6 23L22 6" stroke-dasharray="2 2"/>`),
  fib_extension: svg(`<path d="M12 7h13M12 12h13M12 17h13M12 22h13"/><path d="M3 20l5-12 4 10" stroke-dasharray="2 2"/>`),
  long_position: svg('<rect x="5" y="6" width="18" height="8" fill="rgba(8,153,129,.35)" stroke="#089981"/><rect x="5" y="14" width="18" height="6" fill="rgba(242,54,69,.3)" stroke="#f23645"/>'),
  short_position: svg('<rect x="5" y="8" width="18" height="6" fill="rgba(242,54,69,.3)" stroke="#f23645"/><rect x="5" y="14" width="18" height="8" fill="rgba(8,153,129,.35)" stroke="#089981"/>'),
  text: svg('<path d="M7 7h14M14 7v15M11 22h6"/>'),
  arrow: svg('<path d="M6 22L20 8"/><path d="M12 8h8v8"/>'),
  price_range: svg('<path d="M6 6h16M6 22h16M14 7v14"/><path d="M11 10l3-3 3 3M11 18l3 3 3-3"/>'),
  date_range: svg('<path d="M6 6v16M22 6v16M7 14h14"/><path d="M10 11l-3 3 3 3M18 11l3 3-3 3"/>'),
  brush: svg('<path d="M5 21c3 0 3-3 5-4s4 1 6-2 2-6 6-8"/><path d="M19 5l4 4"/>'),
  magnet: svg('<path d="M8 6v8a6 6 0 0 0 12 0V6"/><path d="M8 6h4v8a2 2 0 0 0 4 0V6h4"/><path d="M8 10h4M16 10h4"/>'),
  lock: svg('<rect x="8" y="13" width="12" height="9" rx="1.5"/><path d="M10.5 13v-3a3.5 3.5 0 0 1 7 0v3"/>'),
  unlock: svg('<rect x="8" y="13" width="12" height="9" rx="1.5"/><path d="M10.5 13v-3a3.5 3.5 0 0 1 6.8-1.2"/>'),
  eye: svg('<path d="M4 14s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="14" cy="14" r="3"/>'),
  eye_off: svg('<path d="M4 14s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="14" cy="14" r="3"/><path d="M5 23L23 5"/>'),
  trash: svg('<path d="M7 9h14M11 9V7h6v2M9 9l1 13h8l1-13M12.5 12v7M15.5 12v7"/>'),
  chevron_down: svg('<path d="M9 12l5 5 5-5"/>', 16, 28),
  chevron_right: svg('<path d="M11 9l5 5-5 5"/>', 10, 28),
  flyout: '<svg width="5" height="5" viewBox="0 0 5 5"><path d="M5 0v5H0z" fill="currentColor"/></svg>',
  // chart types
  candles: svg('<path d="M9 5v4M9 19v4M19 7v3M19 18v3"/><rect x="6.5" y="9" width="5" height="10" fill="currentColor"/><rect x="16.5" y="10" width="5" height="8"/>'),
  hollow: svg('<path d="M9 5v4M9 19v4M19 7v3M19 18v3"/><rect x="6.5" y="9" width="5" height="10"/><rect x="16.5" y="10" width="5" height="8" fill="currentColor"/>'),
  bars: svg('<path d="M9 5v18M6 9h3M9 19h3M19 7v14M16 17h3M19 10h3"/>'),
  line: svg('<path d="M4 20l6-7 5 4 9-11"/>'),
  area: svg('<path d="M4 20l6-7 5 4 9-11v18H4z" fill="currentColor" fill-opacity=".25"/><path d="M4 20l6-7 5 4 9-11"/>'),
  baseline: svg('<path d="M3 14h22" stroke-dasharray="2 2"/><path d="M4 18l5-6 5 5 5-10 5 6"/>'),
  heikin: svg('<path d="M9 5v18M19 5v18"/><rect x="6.5" y="8" width="5" height="9" fill="currentColor"/><rect x="16.5" y="11" width="5" height="9"/>'),
  renko: svg('<rect x="4" y="16" width="6" height="6"/><rect x="11" y="10" width="6" height="6"/><rect x="18" y="4" width="6" height="6" fill="currentColor"/>'),
  range: svg('<path d="M7 6v16M14 9v14M21 5v12"/><rect x="5" y="9" width="4" height="10"/><rect x="12" y="12" width="4" height="8" fill="currentColor"/><rect x="19" y="7" width="4" height="8"/>'),
  footprint: svg('<rect x="5" y="4" width="18" height="20"/><path d="M14 4v20M5 9h18M5 14h18M5 19h18"/><rect x="5" y="14" width="18" height="5" stroke="#f5c542"/>'),
  // toolbar
  indicators: svg('<path d="M5 20c3-9 5-12 8-12 4 0 3 9 10 9"/><path d="M4 7h4M6 5v4" /><path d="M20 21h4"/>'),
  camera: svg('<path d="M5 10h4l2-3h6l2 3h4v11H5z"/><circle cx="14" cy="15" r="3.5"/>'),
  fullscreen: svg('<path d="M5 10V5h5M18 5h5v5M23 18v5h-5M10 23H5v-5"/>'),
  replay: svg('<path d="M6 8v12M10 14l10-7v14z"/>'),
  play: svg('<path d="M9 6l13 8-13 8z" fill="currentColor"/>'),
  pause: svg('<path d="M9 6v16M19 6v16" stroke-width="3"/>'),
  step_fwd: svg('<path d="M7 7l10 7-10 7z" fill="currentColor"/><path d="M21 7v14" stroke-width="2"/>'),
  step_back: svg('<path d="M21 7L11 14l10 7z" fill="currentColor"/><path d="M7 7v14" stroke-width="2"/>'),
  scissors: svg('<circle cx="8" cy="20" r="3"/><circle cx="20" cy="20" r="3"/><path d="M10 18L20 5M18 18L8 5"/>'),
  close: svg('<path d="M8 8l12 12M20 8L8 20"/>'),
  bell: svg('<path d="M14 5a6 6 0 0 0-6 6v4l-2 3h16l-2-3v-4a6 6 0 0 0-6-6zM12 21a2 2 0 0 0 4 0"/>'),
  plus: svg('<path d="M14 7v14M7 14h14"/>'),
  search: svg('<circle cx="12.5" cy="12.5" r="6"/><path d="M17 17l5 5"/>'),
  settings: svg('<circle cx="14" cy="14" r="3"/><path d="M14 4v3M14 21v3M4 14h3M21 14h3M7 7l2 2M19 19l2 2M7 21l2-2M19 9l2-2"/>'),
  star: svg('<path d="M14 5l2.7 5.6 6.1.8-4.4 4.3 1 6.1L14 19l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z"/>'),
  star_filled: svg('<path d="M14 5l2.7 5.6 6.1.8-4.4 4.3 1 6.1L14 19l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z" fill="#f5c542" stroke="#f5c542"/>'),
  vpvr: svg('<path d="M24 5v18"/><path d="M24 7h-6M24 10h-10M24 13h-15M24 16h-11M24 19h-7M24 22h-4" stroke-width="2"/>'),
  calendar: svg('<rect x="5" y="7" width="18" height="16" rx="1.5"/><path d="M5 12h18M10 5v4M18 5v4"/>'),
  sync: svg('<path d="M6 12a8 8 0 0 1 14-4l2 2M22 16a8 8 0 0 1-14 4l-2-2"/><path d="M22 5v5h-5M6 23v-5h5"/>'),
};

/** Layout thumbnails: grid of rects described in a 20×14 box. */
const LAYOUT_RECTS = {
  1: [[0, 0, 20, 14]],
  '2h': [[0, 0, 9.5, 14], [10.5, 0, 9.5, 14]],
  '2v': [[0, 0, 20, 6.5], [0, 7.5, 20, 6.5]],
  3: [[0, 0, 11, 14], [12, 0, 8, 6.5], [12, 7.5, 8, 6.5]],
  4: [[0, 0, 9.5, 6.5], [10.5, 0, 9.5, 6.5], [0, 7.5, 9.5, 6.5], [10.5, 7.5, 9.5, 6.5]],
  6: [[0, 0, 6, 6.5], [7, 0, 6, 6.5], [14, 0, 6, 6.5], [0, 7.5, 6, 6.5], [7, 7.5, 6, 6.5], [14, 7.5, 6, 6.5]],
  8: [[0, 0, 4.25, 6.5], [5.25, 0, 4.25, 6.5], [10.5, 0, 4.25, 6.5], [15.75, 0, 4.25, 6.5], [0, 7.5, 4.25, 6.5], [5.25, 7.5, 4.25, 6.5], [10.5, 7.5, 4.25, 6.5], [15.75, 7.5, 4.25, 6.5]],
};

export function layoutIcon(id, size = 22) {
  const rects = LAYOUT_RECTS[id] || LAYOUT_RECTS[1];
  const body = rects.map(([x, y, w, h]) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="1"/>`).join('');
  return `<svg width="${size}" height="${Math.round((size * 15) / 21)}" viewBox="0 0 21 15" fill="none" stroke="currentColor" stroke-width="1">${body}</svg>`;
}

export function icon(name) {
  return ICONS[name] || ICONS.cursor;
}
