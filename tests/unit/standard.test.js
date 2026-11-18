/*
 * THE STANDARD for errors, failure capture and retries (docs/ARCHITECTURE.md §9b), and convention checks
 * that scan the source so every future change follows it.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, rejects, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  describe('standard › what counts as temporary', () => {
    for (const [code, details, expected] of [
      ['AJP-AI-5XX', null, true], ['AJP-AI-NET', null, true], ['AJP-NET', null, true], ['AJP-STORE', null, true],
      ['AJP-HTTP', { status: 503 }, true], ['AJP-HTTP', { status: 404 }, false],
      ['AJP-AI-429', { retryAfter: 5 }, true], ['AJP-AI-429', { retryAfter: 60 }, false], ['AJP-AI-429', null, false],
      ['AJP-AI-401', null, false], ['AJP-AI-OFF', null, false], ['AJP-AI-TIME', null, false], ['AJP-RES-NONE', null, false], ['AJP-INTERNAL', null, false],
    ]) it(`${code}${details ? ' ' + JSON.stringify(details) : ''} → ${expected ? 'retry' : 'fail fast'}`, () => eq(AJP.isTransient({ ok: false, code, error: 'x', details }), expected));
  });

  describe('standard › retry', () => {
    const transient = () => AJP.err('NETWORK');
    it('retries temporary failures, then succeeds', async () => {
      let n = 0;
      const v = await AJP.retry(async () => {
        if (++n < 3) throw transient();
        return 'ok';
      }, { baseMs: 1 });
      eq([v, n], ['ok', 3]);
    });
    it('fails fast on permanent errors (1 attempt)', async () => {
      let n = 0;
      const e = await rejects(() => AJP.retry(async () => { n++; throw AJP.err('AI_AUTH'); }, { baseMs: 1 }));
      eq([e.code, n], ['AJP-AI-401', 1]);
    });
    it('gives up after `tries` and throws the last error', async () => {
      let n = 0;
      eq((await rejects(() => AJP.retry(async () => { n++; throw transient(); }, { tries: 2, baseMs: 1 }))).code, 'AJP-NET');
      eq(n, 2);
    });
    it('waits the server\'s Retry-After when given', async () => {
      let n = 0;
      const t0 = Date.now();
      await AJP.retry(async () => {
        if (++n === 1) throw AJP.err('AI_RATE_LIMIT', { retryAfter: 0.05 });
        return 1;
      });
      ok(Date.now() - t0 >= 40);
    });
    it('logs each retry as a warning with the code', async () => {
      const got = [];
      const log = { warn: (m, d) => got.push([m, d.code]) };
      let n = 0;
      await AJP.retry(async () => { if (++n < 2) throw transient(); }, { baseMs: 1, log, label: 'unit op' });
      eq(got, [['unit op: retrying (attempt 2/3)', 'AJP-NET']]);
    });
  }, { env: 'browser' });

  describe('standard › http (the only way to call the network)', () => {
    let real;
    let calls;
    const serve = (...responses) => {
      calls = 0;
      globalThis.fetch = async () => {
        const r = responses[Math.min(calls++, responses.length - 1)];
        if (r instanceof Error) throw r;
        return new Response(r.body, { status: r.status || 200, headers: r.headers || {} });
      };
    };
    beforeEach(() => (real = globalThis.fetch));
    afterEach(() => (globalThis.fetch = real));

    it('returns parsed JSON', async () => {
      serve({ body: '{"a":1}' });
      eq(await AJP.http('https://api.example.com/x'), { a: 1 });
    });
    it('retries a 503 and succeeds', async () => {
      serve({ status: 503, body: 'busy' }, { body: '{"ok":true}' });
      eq(await AJP.http('https://api.example.com/x', {}, { tries: 2 }), { ok: true });
      eq(calls, 2);
    });
    it('does not retry a 404; error has status, body and host', async () => {
      serve({ status: 404, body: 'nope' });
      const e = await rejects(() => AJP.http('https://api.example.com/x', {}, { tries: 3 }));
      eq([e.code, e.details.status, e.details.body, e.details.host, calls], ['AJP-HTTP', 404, 'nope', 'api.example.com', 1]);
    });
    it('network failure → AJP-NET (retried)', async () => {
      serve(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
      const e = await rejects(() => AJP.http('https://api.example.com/x', {}, { tries: 2 }));
      eq([e.code, e.details.original, calls], ['AJP-NET', 'Failed to fetch', 2]);
    });
    it('timeout → the given key', async () => {
      globalThis.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      eq((await rejects(() => AJP.http('https://api.example.com/x', {}, { timeoutMs: 30, tries: 1, timeoutKey: 'AI_TIMEOUT' }))).code, 'AJP-AI-TIME');
    });
    it('non-JSON body → coded error', async () => {
      serve({ body: '<html>' });
      eq((await rejects(() => AJP.http('https://api.example.com/x', {}, { tries: 1 }))).code, 'AJP-HTTP');
    });
    it('Retry-After header is read', async () => {
      serve({ status: 429, body: 'slow', headers: { 'retry-after': '7' } });
      eq((await rejects(() => AJP.http('https://api.example.com/x', {}, { tries: 1, statusKey: AJP.aiErrorForStatus }))).details.retryAfter, 7);
    });
    it('AI calls use it: a 503 from the provider is retried', async () => {
      await globalThis.browser.__reset();
      await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'k'; });
      serve({ status: 503, body: 'down' }, { body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
      eq(await AJP.ai.complete({ system: 's', prompt: 'p' }), 'OK');
      eq(calls, 2);
    });
    it('AI calls: a wrong key (401) is not retried', async () => {
      await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'k'; });
      serve({ status: 401, body: 'bad key' });
      eq((await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }))).code, 'AJP-AI-401');
      eq(calls, 1);
    });
  }, { env: 'browser' });

  describe('standard › guard (user actions never fail silently)', () => {
    let saved;
    beforeEach(() => (saved = AJP.getLogSink()));
    afterEach(() => AJP.setLogSink(saved));

    it('returns the result and traces the action', async () => {
      eq(await AJP.guard('unit.ok', async (a, b) => a + b)(2, 3), 5);
    });
    it('a failure is logged with its code + trace id, shown via onError, and never thrown', async () => {
      const got = [];
      AJP.setLogSink(async (e) => got.push(...e));
      let shown = null;
      const r = await AJP.guard('unit.fail', async () => { throw AJP.err('NO_RESUME'); }, { onError: (d) => (shown = d) })();
      await AJP.flushLogs();
      eq(r, undefined);
      eq([shown.code, shown.message], ['AJP-RES-NONE', 'No resume text found.']);
      ok(shown.hint);
      const e = got.find((x) => x.msg === 'unit.fail failed');
      eq(e.code, 'AJP-RES-NONE');
      ok(e.tid);
    });
    it('an unexpected bug becomes AJP-INTERNAL with the original message', async () => {
      let shown = null;
      await AJP.guard('unit.bug', async () => { null.x; }, { onError: (d) => (shown = d) })();
      eq(shown.code, 'AJP-INTERNAL');
      ok(/null|properties/i.test(shown.message));
    });
    it('a broken onError cannot break the app', async () => {
      eq(await AJP.guard('unit.x', async () => { throw new TypeError('x'); }, { onError: () => { throw new Error('ui broke'); } })(), undefined);
    });
    it('panel actions are guarded: a crashing action shows its code in the panel', async () => {
      await globalThis.browser.__reset();
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava' });
      const sh = await waitFor(() => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot.querySelector('[data-act="applied"]') && document.querySelector('ajp-panel').shadowRoot);
      const realSend = AJP.send;
      AJP.send = async (type, ...rest) => { if (type === 'recordApplication') throw new TypeError('boom in the pipeline'); return realSend(type, ...rest); };
      try {
        sh.querySelector('[data-act="applied"]').click();
        await waitFor(() => /AJP-INTERNAL/.test(sh.textContent), { msg: 'code shown' });
        ok(/boom in the pipeline/.test(sh.textContent));
      } finally {
        AJP.send = realSend;
        AJP.panel.remove();
      }
    });
  }, { env: 'browser' });

  describe('standard › messaging and storage recover from blips', () => {
    it('send() retries once while the background is starting up', async () => {
      const mock = globalThis.browser;
      const real = mock.runtime.sendMessage;
      let n = 0;
      mock.runtime.sendMessage = async (m) => {
        if (++n === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return real(m);
      };
      try {
        const r = await AJP.send('ping');
        ok(r.ok);
        eq(n, 2);
      } finally {
        mock.runtime.sendMessage = real;
      }
    });
    it('a storage write that fails once is retried', async () => {
      const mock = globalThis.browser;
      const real = mock.storage.local.set;
      let n = 0;
      mock.storage.local.set = async (o) => {
        if (++n === 1) throw new Error('busy');
        return real(o);
      };
      try {
        await AJP.store.set('answers', { k: { value: 'v' } });
        eq((await AJP.store.get('answers')).k.value, 'v');
        eq(n, 2);
      } finally {
        mock.storage.local.set = real;
      }
    });
  }, { env: 'browser' });

  // ---- Conventions: scan the source so the standard stays constant ---------------------------------
  describe('standard › conventions (source scan)', () => {
    let files = null;
    async function load() {
      if (files) return files;
      const m = await (await fetch('../manifest.json', { cache: 'no-store' })).json();
      const paths = new Set([...m.background.scripts, ...m.content_scripts[0].js]);
      for (const page of ['src/admin/admin.html', 'src/popup/popup.html']) {
        const html = await (await fetch('../' + page, { cache: 'no-store' })).text();
        const dir = page.replace(/[^/]+$/, '');
        for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
          const u = new URL(src, 'http://x/' + dir);
          paths.add(u.pathname.slice(1));
        }
      }
      files = {};
      for (const p of paths) files[p] = await (await fetch('../' + p, { cache: 'no-store' })).text();
      return files;
    }
    const lines = (f) => Object.entries(f).flatMap(([p, t]) => t.split('\n').map((l, i) => ({ p, n: i + 1, l })));

    it('scans every script the extension loads', async () => {
      const f = await load();
      ok(Object.keys(f).length >= 25, Object.keys(f).length + ' files');
      ok(f['src/lib/errors.js'] && f['src/admin/admin.js'] && f['src/content/content.js']);
    });
    it('no `throw new Error(` — failures use AJP.err(KEY) so users get a code + hint', async () => {
      const bad = lines(await load()).filter((x) => /throw new Error\(/.test(x.l) && !/^\s*(\/\/|\*)/.test(x.l));
      eq(bad.map((x) => `${x.p}:${x.n}`), []);
    });
    it('no raw network `fetch(` outside AJP.http (errors.js); local data: URLs allowed', async () => {
      const bad = lines(await load()).filter((x) => /\bfetch\(/.test(x.l) && x.p !== 'src/lib/errors.js' && !/data:|dataUrl/.test(x.l) && !/^\s*(\/\/|\*)/.test(x.l));
      eq(bad.map((x) => `${x.p}:${x.n}`), []);
    });
    it('every AJP.err(KEY) uses a key that exists', async () => {
      const used = new Set(Object.values(await load()).flatMap((t) => [...t.matchAll(/AJP\.err\('([A-Z_]+)'/g)].map((m) => m[1])));
      eq([...used].filter((k) => !AJP.ERRORS[k]), []);
    });
    it('every error code is documented in docs/SUPPORT.md', async () => {
      const support = await (await fetch('../docs/SUPPORT.md', { cache: 'no-store' })).text();
      eq(Object.values(AJP.ERRORS).map((e) => e[0]).filter((c) => !support.includes('`' + c + '`')), []);
    });
    it('no silent empty `catch {}` — every swallowed error says why in a comment', async () => {
      const f = await load();
      const bad = [];
      for (const [p, t] of Object.entries(f)) for (const m of t.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) bad.push(`${p}:${t.slice(0, m.index).split('\n').length}`);
      eq(bad, []);
    });
    it('console is only used by the logger (everything else logs through AJP.logger)', async () => {
      const bad = lines(await load()).filter((x) => /\bconsole\.(log|warn|error|info|debug)\(/.test(x.l) && x.p !== 'src/lib/logger.js');
      eq(bad.map((x) => `${x.p}:${x.n}`), []);
    });
    it('every extension page captures uncaught errors', async () => {
      const f = await load();
      for (const p of ['src/admin/admin.js', 'src/popup/popup.js']) ok(/AJP\.captureErrors\(/.test(f[p]), p);
    });
  }, { env: 'browser' });
})();
