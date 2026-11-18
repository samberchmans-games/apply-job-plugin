/* Minimal URL for the macOS JavaScriptCore CLI runner (which has no URL class). Browsers & Node never load this. */
(function () {
  if (typeof globalThis.URL === 'function') return;
  globalThis.URL = function URL(href) {
    const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#:]+)(:\d+)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(String(href));
    if (!m) throw new TypeError('Invalid URL: ' + href);
    this.href = href;
    this.protocol = m[1].toLowerCase();
    this.hostname = m[2].toLowerCase();
    this.pathname = m[4] || '/';
    this.search = m[5] || '';
    this.hash = m[6] || '';
    const params = {};
    for (const part of this.search.slice(1).split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      const key = decodeURIComponent(k.replace(/\+/g, ' '));
      if (!(key in params)) params[key] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    this.searchParams = { get: (k) => (k in params ? params[k] : null) };
  };
})();
