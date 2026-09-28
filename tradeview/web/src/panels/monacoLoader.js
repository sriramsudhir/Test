// Loads Monaco in the browser only (§14). Primary: bundled ESM via dynamic import with a module worker.
// Fallback: the AMD build from jsDelivr when the bundler cannot provide Monaco.

const CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs';
let promise = null;

async function loadBundled() {
  if (!self.MonacoEnvironment) {
    self.MonacoEnvironment = {
      getWorker() {
        return new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), { type: 'module' });
      },
    };
  }
  const monaco = await import('monaco-editor/editor.js');
  // Editor contributions (find widget, folding, bracket matching, suggestions, hover, ...), no extra languages.
  await import('monaco-editor/features/register.all.js');
  if (!monaco || !monaco.editor) throw new Error('monaco-editor did not load');
  return monaco;
}

function loadFromCdn() {
  return new Promise((resolve, reject) => {
    if (window.monaco && window.monaco.editor) { resolve(window.monaco); return; }
    const boot = () => {
      const req = window.require;
      req.config({ paths: { vs: CDN } });
      window.MonacoEnvironment = {
        getWorkerUrl() {
          const code = `self.MonacoEnvironment={baseUrl:'${CDN}/../'};importScripts('${CDN}/base/worker/workerMain.js');`;
          return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
        },
      };
      req(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    if (window.require && window.require.config) { boot(); return; }
    const s = document.createElement('script');
    s.src = `${CDN}/loader.js`;
    s.async = true;
    s.onload = boot;
    s.onerror = () => reject(new Error('Could not load Monaco from the CDN'));
    document.head.appendChild(s);
  });
}

/** @returns {Promise<typeof import('monaco-editor')>} */
export function loadMonaco() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Monaco is browser-only'));
  if (!promise) {
    promise = loadBundled().catch((err) => {
      console.warn('[pine] bundled Monaco failed, falling back to CDN', err);
      return loadFromCdn();
    });
    promise.catch(() => { promise = null; });
  }
  return promise;
}
