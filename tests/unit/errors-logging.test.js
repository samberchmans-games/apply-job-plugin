/*
 * Support logging: error codes, value redaction, sessions, traces, flight recorder,
 * issue-report bundle, and end-to-end trace correlation (page → background → AI).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  // ---- Pure (CLI + browser) ------------------------------------------------------------
  describe('logging › error codes', () => {
    it('every error has a unique AJP- code, a message and a hint', () => {
      const codes = new Set();
      for (const [key, [code, msg, hint]] of Object.entries(AJP.ERRORS)) {
        ok(/^AJP-[A-Z0-9-]+$/.test(code), key + ' code ' + code);
        ok(msg && hint, key + ' has message and hint');
        codes.add(code);
      }
      // AI_AUTH covers 401 and 403 — all keys still map to distinct codes
      eq(codes.size, Object.keys(AJP.ERRORS).length);
    });
    it('AJP.err builds a coded error with details', () => {
      const e = AJP.err('AI_RATE_LIMIT', { provider: 'groq' });
      ok(e instanceof Error);
      eq([e.code, e.key, e.details.provider], ['AJP-AI-429', 'AI_RATE_LIMIT', 'groq']);
      eq(e.toJSON().code, 'AJP-AI-429');
    });
    it('unknown keys fall back to AJP-INTERNAL', () => eq(AJP.err('NOPE').code, 'AJP-INTERNAL'));
    it('toAppError wraps plain errors, keeping the original text', () => {
      const x = AJP.toAppError(new TypeError('boom'));
      eq([x.code, x.details.original], ['AJP-INTERNAL', 'boom']);
    });
    it('toAppError understands a failed background reply', () => {
      const x = AJP.toAppError({ ok: false, error: 'The free AI limit was reached.', code: 'AJP-AI-429', hint: 'Wait' });
      eq([x.code, x.message, x.hint], ['AJP-AI-429', 'The free AI limit was reached.', 'Wait']);
    });
    it('HTTP status → AI error', () => {
      eq([401, 403, 404, 429, 500, 502, 418].map(AJP.aiErrorForStatus), ['AI_AUTH', 'AI_AUTH', 'AI_MODEL', 'AI_RATE_LIMIT', 'AI_SERVER', 'AI_SERVER', 'AI_HTTP']);
    });
    it('describeError gives message + hint + code for the UI', () => {
      const d = AJP.describeError(AJP.err('NO_RESUME'));
      eq(d.code, 'AJP-RES-NONE');
      includes(d.hint, 'Admin → Resumes');
    });
  });

  describe('logging › redaction of values inside text', () => {
    const cases = [
      ['email', 'Contact ana.silva+jobs@example.co.uk now', 'Contact [email] now'],
      ['Gemini key', 'key AIzaSyA1234567890abcdefghijklmnopqrstuv used', 'key [key] used'],
      ['Groq key', 'gsk_abcdefghijklmnopqrstuvwxyz123456', '[key]'],
      ['OpenRouter key', 'sk-or-v1-abcdef0123456789abcdef0123456789', '[key]'],
      ['OpenAI/Anthropic-style key', 'sk-proj-abcdefghijklmnop1234567890', '[key]'],
      ['Bearer header', 'Authorization: Bearer abc.def.ghi-123', 'Authorization: Bearer [key]'],
      ['key in URL', 'GET https://api.x.com/v1?key=SECRET123&alt=json', 'GET https://api.x.com/v1?key=[key]&alt=json'],
      ['US phone', 'call (512) 555-0100 or +1 512.555.0199', 'call [phone] or [phone]'],
      ['SSN', 'ssn 123-45-6789', 'ssn [ssn]'],
    ];
    for (const [name, input, expected] of cases) it(`masks ${name}`, () => eq(AJP.scrub(input), expected));
    it('does NOT mangle timestamps, salaries, ids, versions or URLs', () => {
      for (const s of ['2026-11-18T12:00:00.000Z', '$150,000 - $190,000', '150000-190000', 'linkedin:4012345678', 'v0.1.0', 'https://boards.greenhouse.io/acme/jobs/5551234', 'took 1234 ms'])
        eq(AJP.scrub(s), s);
    });
    it('applies to messages and nested data values', () => {
      const r = AJP.redact({ note: 'mail me at a@b.co', list: ['tel 512-555-0100'] });
      eq([r.note, r.list[0]], ['mail me at [email]', 'tel [phone]']);
    });
    it('applies to error messages and stacks', () => {
      const r = AJP.redact(new Error('bad key gsk_abcdefghijklmnopqrstuvwxyz'));
      eq(r.message, 'bad key [key]');
    });
  });

  describe('logging › issue report helpers', () => {
    it('recognizes browsers from the user agent', () => {
      const P = AJP.diagnostics.parseBrowser;
      eq(P('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36').name, 'Chrome');
      eq(P('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70').name, 'Edge');
      eq(P('Mozilla/5.0 (Macintosh; rv:133.0) Gecko/20100101 Firefox/133.0'), { name: 'Firefox', version: '133.0' });
      eq(P('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15'), { name: 'Safari', version: '18.1' });
      eq(P('').name, 'Unknown');
    });
    it('report ids look like R-YYYYMMDD-XXXXX', () => ok(/^R-\d{8}-[A-Z0-9]{5}$/.test(AJP.diagnostics.reportId())));
    it('settings summary never contains API keys', () => {
      const s = AJP.diagnostics.summarizeSettings({ ai: { provider: 'groq', model: '', keys: { groq: 'gsk_secretsecretsecret', gemini: '' }, ollamaUrl: 'http://localhost:11434' }, logLevel: 'info', tracker: {} });
      eq(s.hasKey, { groq: true, gemini: false });
      excludes(JSON.stringify(s), 'gsk_');
      eq(s.ollamaUrlIsLocal, true);
    });
    it('error summary counts by code and keeps the last errors', () => {
      const logs = [{ lvl: 'error', code: 'AJP-AI-429', msg: 'a' }, { lvl: 'error', code: 'AJP-AI-429', msg: 'b' }, { lvl: 'error', msg: 'c' }, { lvl: 'warn', msg: 'w' }, { lvl: 'info', msg: 'i' }];
      const e = AJP.diagnostics.errorSummary(logs);
      eq([e.total, e.warnings, e.byCode], [3, 1, { 'AJP-AI-429': 2, uncoded: 1 }]);
    });
    it('final scrub masks anything that slipped into the bundle', () => {
      const b = AJP.diagnostics.finalScrub({ description: 'I am ana@example.com, key gsk_abcdefghijklmnopqrstuv', logs: [{ msg: 'phone 512-555-0100' }] });
      excludes(JSON.stringify(b), 'ana@example.com');
      excludes(JSON.stringify(b), 'gsk_');
      excludes(JSON.stringify(b), '555-0100');
    });
  });

  // ---- Browser ------------------------------------------------------------------------
  const mock = globalThis.browser;
  let saved;
  const capture = () => {
    const got = [];
    saved = AJP.getLogSink();
    AJP.setLogSink(async (e) => {
      got.push(...e);
      if (saved) await saved(e);
    });
    return got;
  };
  const restore = () => {
    AJP.setLogSink(saved);
    AJP.setLogLevel('debug');
  };

  describe('logging › sessions, traces and timing', () => {
    afterEach(restore);

    it('every entry carries the session id of its page', async () => {
      const got = capture();
      AJP.logger('unit').info('hello');
      await AJP.flushLogs();
      eq(got.find((e) => e.msg === 'hello').sid, AJP.sessionId);
      ok(/^s[a-z0-9]{7}$/.test(AJP.sessionId));
    });
    it('a trace logs start/done with duration and one shared trace id', async () => {
      const got = capture();
      AJP.setLogLevel('debug');
      const tr = AJP.startTrace('unit.action', { mod: 'unit' });
      tr.log.info('step 1');
      tr.end({ items: 3 });
      await AJP.flushLogs();
      const mine = got.filter((e) => e.tid === tr.id);
      eq(mine.map((e) => e.msg), ['unit.action start', 'step 1', 'unit.action done']);
      eq(mine[2].data.items, 3);
      ok(typeof mine[2].data.ms === 'number');
    });
    it('slow actions are logged as warnings', async () => {
      const got = capture();
      const tr = AJP.startTrace('unit.slow', { mod: 'unit', slowMs: -1 });
      tr.end();
      await AJP.flushLogs();
      eq(got.find((e) => e.tid === tr.id && e.msg === 'unit.slow slow').lvl, 'warn');
    });
    it('a failed trace logs an error with code, message and duration', async () => {
      const got = capture();
      const tr = AJP.startTrace('unit.fail', { mod: 'unit' });
      const x = tr.fail(AJP.err('AI_TIMEOUT', { seconds: 90 }));
      await AJP.flushLogs();
      const e = got.find((y) => y.tid === tr.id && y.lvl === 'error');
      eq([x.code, e.code, e.data.details.seconds], ['AJP-AI-TIME', 'AJP-AI-TIME', 90]);
    });
    it('flight recorder: debug details before an error are kept even at level "warn"', async () => {
      const got = capture();
      AJP.setLogLevel('warn');
      const log = AJP.logger('unit');
      log.debug('clicked autofill');
      log.info('found 12 fields');
      log.error('fill crashed', null, { code: 'AJP-INTERNAL' });
      await AJP.flushLogs();
      const pre = got.filter((e) => e.pre).map((e) => e.msg);
      includes(pre, 'clicked autofill');
      includes(pre, 'found 12 fields');
      eq(got.find((e) => e.msg === 'fill crashed').code, 'AJP-INTERNAL');
    });
    it('without an error, below-level entries are not stored', async () => {
      const got = capture();
      AJP.setLogLevel('warn');
      AJP.logger('unit').debug('quiet detail');
      AJP.logger('unit').warn('a warning');
      await AJP.flushLogs();
      notOk(got.some((e) => e.msg === 'quiet detail'));
    });
  }, { env: 'browser' });

  describe('logging › background replies and trace correlation', () => {
    let realFetch;
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
      AJP.setLogLevel('debug');
    });
    afterEach(() => (globalThis.fetch = realFetch));

    it('failed replies include code, hint and trace id', async () => {
      const r = await AJP.send('ai.test');
      eq([r.ok, r.code], [false, 'AJP-AI-OFF']);
      ok(r.hint && r.tid);
    });
    it('one user action shares a trace id from page → background → AI', async () => {
      await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'gsk-test'; });
      globalThis.fetch = async () => new Response('{"error":"slow down"}', { status: 429 });
      const tr = AJP.startTrace('unit.panelAction', { mod: 'content' });
      const r = await AJP.send('ai.extractSkills', { jd: 'JD' }, tr);
      tr.fail(r);
      eq([r.code, r.tid], ['AJP-AI-429', tr.id]);
      await AJP.flushLogs();
      const logs = await waitFor(async () => {
        const l = (await AJP.store.get('logs')).filter((e) => e.tid === tr.id);
        return l.length >= 3 && l;
      }, { msg: 'correlated entries' });
      const mods = new Set(logs.map((e) => e.mod));
      ok(mods.has('ai') && mods.has('background') && mods.has('content'), [...mods].join(','));
      ok(logs.filter((e) => e.lvl === 'error').every((e) => e.code === 'AJP-AI-429'));
      const aiErr = logs.find((e) => e.mod === 'ai' && e.lvl === 'error');
      eq(aiErr.data.details.status, 429);
      includes(aiErr.data.details.body, 'slow down');
      excludes(JSON.stringify(logs), 'gsk-test');
    });
    it('background logs where a message came from (host only, never the full URL)', async () => {
      await AJP.send('ai.test');
      await AJP.flushLogs();
      const e = await waitFor(async () => (await AJP.store.get('logs')).find((x) => x.msg === 'msg ai.test failed'));
      eq([e.data.from, e.data.host], ['page', location.hostname]);
      excludes(JSON.stringify(e.data), location.pathname);
    });
    it('ping reports background health', async () => {
      const r = await AJP.send('ping');
      ok(r.ok);
      eq(r.version, AJP.VERSION);
      ok(typeof r.uptimeSec === 'number' && r.sessionId);
    });
    it('a storage write failure is logged with AJP-STORE and surfaced', async () => {
      const realSet = mock.storage.local.set;
      mock.storage.local.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
      let e;
      try {
        await AJP.store.set('answers', { a: 1 });
      } catch (x) {
        e = x;
      } finally {
        mock.storage.local.set = realSet;
      }
      eq([e.code, e.details.key], ['AJP-STORE', 'answers']);
      includes(e.details.original, 'quota');
    });
    it('the panel shows the error code and hint to the user', async () => {
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava' });
      const sh = await waitFor(() => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot.querySelector('[data-act="ai"]') && document.querySelector('ajp-panel').shadowRoot, { msg: 'panel' });
      sh.querySelector('[data-act="ai"]').click();
      await waitFor(() => /AJP-AI-OFF/.test(sh.textContent), { msg: 'code shown' });
      includes(sh.textContent, 'Pick a free provider');
      AJP.panel.remove();
    });
  }, { env: 'browser' });

  describe('logging › issue report bundle', () => {
    beforeEach(async () => {
      await mock.__reset();
      await AJP.store.update('profile', (p) => {
        p.personal.firstName = 'Ana';
        p.personal.email = 'ana@example.com';
        p.personal.phone = '512-555-0100';
        p.skills = [{ name: 'Java' }, { name: 'AWS' }];
        p.autoApply.eeo.race = 'SECRET_RACE';
      });
      await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'gsk_abcdefghijklmnopqrstuvwxyz'; });
      await AJP.store.set('resumes', { activeId: 'r1', items: [{ id: 'r1', name: 'Mine', text: 'RESUME BODY TEXT', file: { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' } }] });
      await AJP.store.set('applications', [{ id: 'a', status: 'applied', company: 'Acme' }, { id: 'b', status: 'interviewing' }]);
      await AJP.store.set('logs', [
        { t: '2026-11-18T10:00:00Z', lvl: 'info', ctx: 'content', sid: 's1', mod: 'x', msg: 'ok' },
        { t: '2026-11-18T10:00:01Z', lvl: 'error', ctx: 'bg', sid: 's2', mod: 'ai', msg: 'ai failed for ana@example.com', code: 'AJP-AI-429', tid: 't1' },
      ]);
    });

    it('has id, description, environment, settings, data counts, health, errors, sessions, logs', async () => {
      const b = await AJP.diagnostics.collect({ description: 'Autofill missed the phone field on Workday' });
      ok(/^R-/.test(b.reportId));
      eq(b.kind, 'issue-report');
      includes(b.description, 'Workday');
      eq(b.environment.extensionVersion, AJP.VERSION);
      ok(b.environment.browser.name && b.environment.timeZone !== undefined);
      eq([b.settings.aiProvider, b.settings.hasKey.groq], ['groq', true]);
      eq([b.data.skills, b.data.resumes.count, b.data.resumes.activeHasFile, b.data.resumes.activeTextChars], [2, 1, true, 16]);
      eq(b.data.applications, { total: 2, byStatus: { applied: 1, interviewing: 1 } });
      eq([b.data.profileFilled.firstName, b.data.profileFilled.linkedin], [true, false]);
      eq([b.health.background.ok, b.health.storage.ok], [true, true]);
      // (entries still buffered from earlier actions are flushed into the report too — by design)
      eq(b.errors.byCode['AJP-AI-429'], 1);
      ok(['s1', 's2'].every((sid) => b.sessions.some((x) => x.sid === sid)));
      ok(b.logs.some((l) => l.tid === 't1'));
    });
    it('contains NO personal content: no name, email, phone, resume text, file, EEO or keys', async () => {
      const b = await AJP.diagnostics.collect({ description: 'reach me at ana@example.com' });
      const json = JSON.stringify(b);
      for (const secret of ['ana@example.com', '512-555-0100', 'RESUME BODY TEXT', 'base64,AAAA', 'SECRET_RACE', 'gsk_abcdefghijklmnopqrstuvwxyz', '"Ana"'])
        excludes(json, secret);
    });
    it('can leave logs out', async () => eq((await AJP.diagnostics.collect({ includeLogs: false })).logs, []));
    it('caps the number of log entries', async () => {
      await AJP.store.set('logs', Array.from({ length: 50 }, (_, i) => ({ lvl: 'info', msg: 'm' + i })));
      const b = await AJP.diagnostics.collect({ maxLogs: 10 });
      eq([b.logs.length, b.logs[9].msg], [10, 'm49']);
    });
    it('summary text is short and has the report id, version, browser and error codes', async () => {
      const b = await AJP.diagnostics.collect({ description: 'Panel did not open' });
      const t = AJP.diagnostics.summaryText(b);
      includes(t, b.reportId);
      includes(t, 'Version ' + AJP.VERSION);
      ok(/AJP-AI-429 ×\d/.test(t), t);
      includes(t, 'Panel did not open');
      ok(t.split('\n').length <= 8);
    });
    it('reports a dead background clearly', async () => {
      const realSend = AJP.send;
      AJP.send = async () => ({ ok: false, error: 'Could not establish connection', code: 'AJP-INTERNAL' });
      try {
        const b = await AJP.diagnostics.collect();
        eq(b.health.background.ok, false);
        includes(b.health.background.error, 'Could not establish');
      } finally {
        AJP.send = realSend;
      }
    });
  }, { env: 'browser' });
})();
