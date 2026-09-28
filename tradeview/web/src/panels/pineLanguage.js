// Pine Script v6 language support for Monaco: Monarch tokenizer, language configuration,
// completion items for built-in namespaces and a TradingView-like dark theme.

export const PINE_KEYWORDS = [
  'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'break', 'continue', 'return',
  'var', 'varip', 'import', 'export', 'method', 'type', 'enum', 'and', 'or', 'not', 'as',
];
export const PINE_TYPES = [
  'int', 'float', 'bool', 'color', 'string', 'line', 'label', 'box', 'table', 'array', 'matrix', 'map',
  'series', 'simple', 'const', 'input', 'polyline', 'linefill', 'chart.point', 'void',
];
export const PINE_DECLARATIONS = ['indicator', 'strategy', 'library'];
export const PINE_BUILTIN_VARS = [
  'open', 'high', 'low', 'close', 'volume', 'time', 'time_close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'bar_index',
  'last_bar_index', 'last_bar_time', 'na', 'timenow', 'year', 'month', 'weekofyear', 'dayofmonth', 'dayofweek',
  'hour', 'minute', 'second', 'syminfo', 'barstate', 'timeframe', 'session',
];
export const PINE_FUNCTIONS = [
  'plot', 'plotshape', 'plotchar', 'plotarrow', 'plotbar', 'plotcandle', 'hline', 'fill', 'bgcolor', 'barcolor',
  'alert', 'alertcondition', 'nz', 'fixnan', 'na', 'input', 'max_bars_back', 'runtime', 'log',
  'int', 'float', 'bool', 'string', 'color',
];

export const PINE_NAMESPACES = {
  ta: ['sma', 'ema', 'rma', 'wma', 'vwma', 'hma', 'alma', 'swma', 'linreg', 'rsi', 'macd', 'stoch', 'atr', 'tr', 'bb', 'bbw', 'kc', 'kcw',
    'cci', 'cmo', 'mfi', 'mom', 'roc', 'tsi', 'wpr', 'dmi', 'sar', 'supertrend', 'vwap', 'obv', 'accdist', 'pvt', 'iii', 'wad', 'wvad', 'nvi', 'pvi',
    'crossover', 'crossunder', 'cross', 'highest', 'lowest', 'highestbars', 'lowestbars', 'pivothigh', 'pivotlow', 'change', 'cum',
    'stdev', 'variance', 'dev', 'median', 'mode', 'range', 'percentrank', 'percentile_linear_interpolation', 'percentile_nearest_rank',
    'correlation', 'barssince', 'valuewhen', 'falling', 'rising', 'max', 'min', 'pivot_point_levels'],
  math: ['abs', 'acos', 'asin', 'atan', 'avg', 'ceil', 'cos', 'exp', 'floor', 'log', 'log10', 'max', 'min', 'pow', 'random', 'round',
    'round_to_mintick', 'sign', 'sin', 'sqrt', 'sum', 'tan', 'todegrees', 'toradians', 'pi', 'e', 'phi', 'rphi'],
  strategy: ['entry', 'exit', 'close', 'close_all', 'order', 'cancel', 'cancel_all', 'long', 'short', 'position_size', 'position_avg_price',
    'equity', 'netprofit', 'openprofit', 'grossprofit', 'grossloss', 'closedtrades', 'opentrades', 'wintrades', 'losstrades',
    'initial_capital', 'max_drawdown', 'fixed', 'cash', 'percent_of_equity', 'commission', 'risk'],
  request: ['security', 'security_lower_tf', 'financial', 'quandl', 'splits', 'dividends', 'earnings', 'currency_rate', 'economic', 'seed'],
  input: ['int', 'float', 'bool', 'string', 'color', 'source', 'timeframe', 'symbol', 'session', 'price', 'time', 'text_area', 'enum'],
  color: ['new', 'rgb', 'r', 'g', 'b', 't', 'from_gradient', 'aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon', 'navy',
    'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow'],
  str: ['tostring', 'tonumber', 'format', 'length', 'contains', 'replace', 'replace_all', 'split', 'substring', 'upper', 'lower', 'startswith', 'endswith', 'pos', 'match', 'trim', 'repeat', 'format_time'],
  array: ['new', 'new_float', 'new_int', 'new_bool', 'new_string', 'new_color', 'from', 'push', 'pop', 'get', 'set', 'size', 'shift', 'unshift',
    'insert', 'remove', 'clear', 'slice', 'sum', 'avg', 'max', 'min', 'sort', 'reverse', 'includes', 'indexof', 'join', 'copy', 'first', 'last', 'stdev'],
  line: ['new', 'set_xy1', 'set_xy2', 'set_color', 'set_width', 'set_style', 'delete', 'get_price', 'style_solid', 'style_dashed', 'style_dotted'],
  label: ['new', 'set_text', 'set_xy', 'set_color', 'set_textcolor', 'delete', 'style_label_up', 'style_label_down', 'style_none'],
  box: ['new', 'set_lefttop', 'set_rightbottom', 'set_bgcolor', 'set_border_color', 'delete'],
  table: ['new', 'cell', 'cell_set_text', 'delete'],
  plot: ['style_line', 'style_histogram', 'style_columns', 'style_area', 'style_circles', 'style_cross', 'style_stepline', 'style_linebr'],
  shape: ['triangleup', 'triangledown', 'arrowup', 'arrowdown', 'circle', 'cross', 'xcross', 'diamond', 'square', 'flag', 'labelup', 'labeldown'],
  location: ['abovebar', 'belowbar', 'top', 'bottom', 'absolute'],
  size: ['auto', 'tiny', 'small', 'normal', 'large', 'huge'],
  position: ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'],
  display: ['all', 'none', 'data_window', 'pane', 'price_scale', 'status_line'],
  barstate: ['isfirst', 'islast', 'ishistory', 'isrealtime', 'isnew', 'isconfirmed', 'islastconfirmedhistory'],
  syminfo: ['ticker', 'tickerid', 'mintick', 'pointvalue', 'currency', 'basecurrency', 'type', 'session', 'timezone', 'description', 'root', 'prefix'],
  timeframe: ['period', 'multiplier', 'isintraday', 'isdaily', 'isweekly', 'ismonthly', 'isseconds', 'isminutes', 'in_seconds', 'from_seconds', 'change'],
  extend: ['none', 'left', 'right', 'both'],
  xloc: ['bar_index', 'bar_time'],
  yloc: ['price', 'abovebar', 'belowbar'],
  alert: ['freq_once_per_bar', 'freq_once_per_bar_close', 'freq_all'],
  format: ['price', 'volume', 'percent', 'inherit', 'mintick'],
  scale: ['left', 'right', 'none'],
  currency: ['USD', 'USDT', 'EUR', 'BTC'],
  order: ['ascending', 'descending'],
  map: ['new', 'put', 'get', 'contains', 'remove', 'keys', 'values', 'size', 'clear'],
  matrix: ['new', 'get', 'set', 'rows', 'columns', 'add_row', 'add_col'],
};

export const PINE_LANGUAGE_ID = 'pine';

export const pineLanguageConfiguration = {
  comments: { lineComment: '//' },
  brackets: [['(', ')'], ['[', ']'], ['{', '}']],
  autoClosingPairs: [
    { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' },
    { open: '"', close: '"', notIn: ['string'] }, { open: "'", close: "'", notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
  indentationRules: {
    increaseIndentPattern: /^\s*(if|else|for|while|switch)\b.*$|=>\s*$|^\s*\w[\w.]*\s*\(.*\)\s*=>\s*$/,
    decreaseIndentPattern: /^\s*else\b/,
  },
  onEnterRules: [],
  folding: { offSide: true },
};

/** Monarch tokenizer. */
export const pineMonarch = {
  defaultToken: '',
  tokenPostfix: '.pine',
  keywords: PINE_KEYWORDS,
  typeKeywords: PINE_TYPES,
  declarations: PINE_DECLARATIONS,
  builtinVars: PINE_BUILTIN_VARS,
  builtinFns: PINE_FUNCTIONS,
  namespaces: Object.keys(PINE_NAMESPACES),
  constants: ['true', 'false', 'na'],
  operators: ['=', ':=', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '?', ':', '=>', '+=', '-=', '*=', '/=', '%='],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,
  tokenizer: {
    root: [
      // version / compiler annotations: //@version=6, // @description ..., //@function ...
      [/\/\/\s*@version\s*=\s*\d+/, 'annotation'],
      [/\/\/\s*@(description|function|param|returns|type|field|variable|enum|strategy_alert_message)\b/, { token: 'annotation', next: '@annotationRest' }],
      [/\/\/.*$/, 'comment'],
      // colors
      [/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b/, 'color'],
      [/\bcolor\.(aqua|black|blue|fuchsia|gray|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|white|yellow)\b/, 'color'],
      // namespace.member (ta.ema, math.max, strategy.entry, request.security, ...)
      [/\b([a-z_]+)(\.)([a-zA-Z_]\w*)/, [
        { cases: { '@namespaces': 'namespace', '@default': 'identifier' } },
        'delimiter',
        'function.builtin',
      ]],
      // function declaration: name(args) =>
      [/^([a-zA-Z_]\w*)(\s*)(\()(?=[^)]*\)\s*=>)/, ['function.decl', '', '@brackets']],
      // identifiers & keywords
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@declarations': 'keyword.declaration',
          '@keywords': 'keyword',
          '@typeKeywords': 'type',
          '@constants': 'constant',
          '@builtinVars': 'variable.predefined',
          '@builtinFns': 'function.builtin',
          '@default': 'identifier',
        },
      }],
      { include: '@whitespace' },
      [/[{}()[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      // numbers
      [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
      [/\d+[eE][-+]?\d+/, 'number.float'],
      [/\d+/, 'number'],
      [/[,.]/, 'delimiter'],
      // strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, { token: 'string.quote', bracket: '@open', next: '@stringDouble' }],
      [/'/, { token: 'string.quote', bracket: '@open', next: '@stringSingle' }],
    ],
    annotationRest: [[/.*$/, { token: 'comment.doc', next: '@pop' }]],
    whitespace: [[/[ \t\r\n]+/, '']],
    stringDouble: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
    stringSingle: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
};

export const PINE_THEME = 'tradeview-dark';

export const pineTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd1d4dc' },
    { token: 'comment', foreground: '5d606b', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '7e8190', fontStyle: 'italic' },
    { token: 'annotation', foreground: 'c678dd', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f06292' },
    { token: 'keyword.declaration', foreground: '2962ff', fontStyle: 'bold' },
    { token: 'type', foreground: '26c6da' },
    { token: 'constant', foreground: 'ff9800' },
    { token: 'number', foreground: 'ff9800' },
    { token: 'number.float', foreground: 'ff9800' },
    { token: 'string', foreground: '81c784' },
    { token: 'string.quote', foreground: '81c784' },
    { token: 'string.escape', foreground: 'aed581' },
    { token: 'string.invalid', foreground: 'f23645' },
    { token: 'color', foreground: 'ffca28' },
    { token: 'namespace', foreground: '5b9cf6' },
    { token: 'function.builtin', foreground: '4fc3f7' },
    { token: 'function.decl', foreground: 'ffd54f' },
    { token: 'variable.predefined', foreground: 'ce93d8' },
    { token: 'operator', foreground: 'b2b5be' },
    { token: 'delimiter', foreground: '787b86' },
    { token: 'identifier', foreground: 'd1d4dc' },
  ],
  colors: {
    'editor.background': '#131722',
    'editor.foreground': '#d1d4dc',
    'editorLineNumber.foreground': '#4c525e',
    'editorLineNumber.activeForeground': '#b2b5be',
    'editorCursor.foreground': '#2962ff',
    'editor.selectionBackground': '#2962ff44',
    'editor.inactiveSelectionBackground': '#2962ff22',
    'editor.lineHighlightBackground': '#1e222d',
    'editor.lineHighlightBorder': '#1e222d',
    'editorIndentGuide.background1': '#2a2e39',
    'editorIndentGuide.activeBackground1': '#434651',
    'editorWidget.background': '#1e222d',
    'editorWidget.border': '#2a2e39',
    'editorSuggestWidget.background': '#1e222d',
    'editorSuggestWidget.border': '#2a2e39',
    'editorSuggestWidget.selectedBackground': '#2962ff33',
    'editorHoverWidget.background': '#1e222d',
    'editorHoverWidget.border': '#2a2e39',
    'editorGutter.background': '#131722',
    'scrollbarSlider.background': '#363a4566',
    'scrollbarSlider.hoverBackground': '#363a45aa',
    'editorError.foreground': '#f23645',
    'editorWarning.foreground': '#ff9800',
  },
};

let registered = false;

/** Register the language, tokenizer, theme and completions once. */
export function registerPine(monaco) {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: PINE_LANGUAGE_ID, extensions: ['.pine'], aliases: ['Pine Script', 'pine'] });
  monaco.languages.setLanguageConfiguration(PINE_LANGUAGE_ID, pineLanguageConfiguration);
  monaco.languages.setMonarchTokensProvider(PINE_LANGUAGE_ID, pineMonarch);
  monaco.editor.defineTheme(PINE_THEME, pineTheme);

  const K = monaco.languages.CompletionItemKind;
  monaco.languages.registerCompletionItemProvider(PINE_LANGUAGE_ID, {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const ns = /([a-z_]+)\.(\w*)$/.exec(line);
      if (ns && PINE_NAMESPACES[ns[1]]) {
        return {
          suggestions: PINE_NAMESPACES[ns[1]].map((m) => ({
            label: m,
            kind: /^[a-z_]+$/.test(m) && !/^(style_|freq_|is|new$)/.test(m) && ['ta', 'math', 'str', 'array', 'request', 'input', 'map', 'matrix'].includes(ns[1]) ? K.Function : K.Property,
            insertText: m,
            detail: `${ns[1]}.${m}`,
            range,
          })),
        };
      }
      const s = [];
      for (const k of PINE_KEYWORDS) s.push({ label: k, kind: K.Keyword, insertText: k, range });
      for (const t of PINE_TYPES) s.push({ label: t, kind: K.TypeParameter, insertText: t, range });
      for (const v of PINE_BUILTIN_VARS) s.push({ label: v, kind: K.Variable, insertText: v, range });
      for (const f of PINE_FUNCTIONS) s.push({ label: f, kind: K.Function, insertText: f, range });
      for (const n of Object.keys(PINE_NAMESPACES)) s.push({ label: n, kind: K.Module, insertText: n, range });
      const snip = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      s.push({ label: 'indicator', kind: K.Snippet, insertTextRules: snip, range, detail: 'indicator declaration',
        insertText: 'indicator("${1:My indicator}", overlay=${2:true})' });
      s.push({ label: 'strategy', kind: K.Snippet, insertTextRules: snip, range, detail: 'strategy declaration',
        insertText: 'strategy("${1:My strategy}", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)' });
      s.push({ label: 'plot', kind: K.Snippet, insertTextRules: snip, range, detail: 'plot(series, title, color)',
        insertText: 'plot(${1:close}, "${2:Plot}", color=${3:color.blue})' });
      s.push({ label: 'input.int', kind: K.Snippet, insertTextRules: snip, range, detail: 'integer input',
        insertText: '${1:len} = input.int(${2:14}, "${3:Length}", minval=1)' });
      return { suggestions: s };
    },
  });
}

export const PINE_TEMPLATES = {
  indicator: `//@version=6
indicator("My indicator", overlay=true)
len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
basis = ta.ema(src, len)
plot(basis, "EMA", color=color.new(#2962ff, 0), linewidth=2)
`,
  oscillator: `//@version=6
indicator("My oscillator", overlay=false)
len = input.int(14, "Length", minval=1)
r = ta.rsi(close, len)
plot(r, "RSI", color=#7e57c2)
hline(70, "Overbought", color=#787b86)
hline(30, "Oversold", color=#787b86)
`,
  strategy: `//@version=6
strategy("EMA Cross strategy", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fastLen = input.int(9, "Fast EMA")
slowLen = input.int(21, "Slow EMA")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
plot(fast, "Fast", color=#2962ff)
plot(slow, "Slow", color=#ff9800)
`,
};
