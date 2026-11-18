(function () {
  const { describe, it, eq, ok, includes, excludes } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  describe('logger › redaction (safe to share)', () => {
    it('redacts API keys, tokens, passwords', () => {
      const r = AJP.redact({ apiKey: 'sk-1', api_key: 'x', token: 't', password: 'p', authorization: 'Bearer z', ok: 'fine' });
      eq(r, { apiKey: '[redacted]', api_key: '[redacted]', token: '[redacted]', password: '[redacted]', authorization: '[redacted]', ok: 'fine' });
    });
    it('redacts contact details', () => eq(AJP.redact({ email: 'a@b.c', phone: '555' }), { email: '[redacted]', phone: '[redacted]' }));
    it('redacts EEO data', () => {
      const r = AJP.redact({ eeo: { race: 'x' }, race: 'x', veteran: 'y', disability: 'z', gender: 'g' });
      for (const v of Object.values(r)) eq(v, '[redacted]');
    });
    it('redacts nested keys and the settings.ai.keys object', () => {
      const r = AJP.redact({ settings: { ai: { provider: 'groq', keys: { groq: 'gsk_secret' } } } });
      eq(r.settings.ai.provider, 'groq');
      eq(r.settings.ai.keys, '[redacted]');
    });
    it('redacts resume file data URLs', () => eq(AJP.redact({ dataUrl: 'data:application/pdf;base64,AAAA' }).dataUrl, '[redacted]'));
    it('truncates very long strings', () => {
      const s = AJP.redact('x'.repeat(5000));
      ok(s.length < 1600);
      includes(s, '[5000 chars]');
    });
    it('serializes Error objects with a short stack', () => {
      const r = AJP.redact(new TypeError('bad thing'));
      eq(r.name, 'TypeError');
      eq(r.message, 'bad thing');
      ok(r.stack.split('\n').length <= 6);
    });
    it('limits depth and array size', () => {
      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      eq(AJP.redact(deep).a.b.c.d, '[…]');
      eq(AJP.redact({ list: new Array(100).fill(1) }).list.length, 40);
    });
    it('passes primitives through', () => {
      eq(AJP.redact(5), 5);
      eq(AJP.redact(null), null);
      eq(AJP.redact(true), true);
    });
    it('does not mutate the input', () => {
      const o = { apiKey: 'k' };
      AJP.redact(o);
      eq(o.apiKey, 'k');
    });
  });

  describe('logger › levels, batching and persistence', () => {
    let saved;
    globalThis.AJPTest.beforeEach(() => (saved = AJP.getLogSink()));
    globalThis.AJPTest.afterEach(() => {
      AJP.setLogSink(saved);
      AJP.setLogLevel('debug');
    });
    it('writes entries with time, level, context, module, message, data', async () => {
      const got = [];
      AJP.setLogSink(async (e) => got.push(...e));
      AJP.setLogLevel('debug');
      AJP.logger('unit').info('hello', { n: 1, apiKey: 'secret' });
      await AJP.flushLogs();
      const e = got.find((x) => x.msg === 'hello');
      ok(e, 'entry written');
      eq([e.lvl, e.mod, e.data.n, e.data.apiKey], ['info', 'unit', 1, '[redacted]']);
      ok(/^\d{4}-\d\d-\d\dT/.test(e.t));
      ok(e.ctx);
    });
    it('drops entries below the minimum level', async () => {
      const got = [];
      AJP.setLogSink(async (e) => got.push(...e));
      AJP.setLogLevel('warn');
      const log = AJP.logger('unit');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
      await AJP.flushLogs();
      eq(got.map((x) => x.lvl), ['warn', 'error']);
    });
    it('ignores unknown level names', () => {
      AJP.setLogLevel('info');
      AJP.setLogLevel('nonsense');
      ok(true);
    });
    it('a failing sink never throws into app code', async () => {
      AJP.setLogSink(async () => { throw new Error('disk full'); });
      AJP.setLogLevel('info');
      AJP.logger('unit').info('x');
      await AJP.flushLogs();
      ok(true);
    });
    it('flushes automatically after a short delay', async () => {
      const got = [];
      AJP.setLogSink(async (e) => got.push(...e));
      AJP.setLogLevel('info');
      AJP.logger('unit').error('auto');
      await globalThis.AJPTest.waitFor(() => got.length, { msg: 'auto flush' });
      excludes(got.map((x) => x.msg), 'never');
    });
  }, { env: 'browser' });
})();
