(function () {
  const { describe, it, eq, ok, notOk, includes, excludes } = globalThis.AJPTest;
  const I = globalThis.AJP.issues;

  const bundle = (over = {}) => ({
    reportId: 'R-20261118-7KQ2D',
    description: 'Draft answer failed on Lever. Contact me at ana@example.com or 512-555-0100. Job: https://jobs.lever.co/acme/123',
    environment: { extensionVersion: '0.1.0', browser: { name: 'Chrome', version: '131.0' }, platform: 'macOS' },
    settings: { aiProvider: 'groq', aiModel: 'default', logLevel: 'info' },
    data: { tracks: 2 },
    health: { background: { ok: true } },
    errors: { byCode: { 'AJP-AI-429': 2, 'AJP-JD-NONE': 1, uncoded: 1 }, last: [{ code: 'AJP-AI-429', msg: 'ai.draftAnswer failed for key gsk_abcdefghijklmnopqrstuv' }] },
    logs: [{ msg: 'SECRET LOG LINE about https://careers.secret-company.com/job/42' }],
    ...over,
  });
  const params = (url) => Object.fromEntries(url.split('?')[1].split('&').map((kv) => kv.split('=').map(decodeURIComponent)));

  describe('issue reports › pre-filled GitHub issue', () => {
    const { url, fields } = I.buildIssueUrl(bundle());
    const p = params(url);
    it('opens the "Problem report" form on the project repo', () => {
      ok(url.startsWith('https://github.com/samberchmans-games/apply-job-plugin/issues/new?'));
      eq(p.template, 'bug_report.yml');
    });
    it('title has the code first and the report id last', () => {
      ok(fields.title.startsWith('[AJP-AI-429] Draft answer failed on Lever.'));
      ok(fields.title.endsWith('(R-20261118-7KQ2D)'));
    });
    it('every form field is filled', () => {
      eq([p.report_id, p.codes, p.version, p.browser], ['R-20261118-7KQ2D', 'AJP-AI-429, AJP-JD-NONE', 'v0.1.0', 'Chrome']);
      includes(p.environment, 'Browser: Chrome 131.0');
      includes(p.environment, 'AI: groq / default');
      includes(p.environment, 'Tracks: 2');
      includes(p.environment, 'Errors: AJP-AI-429 ×2, AJP-JD-NONE ×1');
      includes(p.what_happened, 'Last error: [AJP-AI-429]');
    });
    it('public text: emails, phone numbers, keys and links are masked', () => {
      const values = Object.values(p).join('\n');
      for (const secret of ['ana@example.com', '512-555-0100', 'gsk_abcdefghijklmnopqrstuv', 'jobs.lever.co', 'https://']) excludes(values, secret);
      includes(p.what_happened, '[email]');
      includes(p.what_happened, '[link]');
    });
    it('never includes logs', () => {
      excludes(decodeURIComponent(url), 'SECRET LOG LINE');
      excludes(decodeURIComponent(url), 'secret-company');
    });
    it('the code from a crash prompt goes first', () => eq(I.buildIssueUrl(bundle(), { code: 'AJP-INTERNAL' }).fields.codes, 'AJP-INTERNAL, AJP-AI-429, AJP-JD-NONE'));
    it('no codes → [report] in the title; unknown browser → Other', () => {
      const f = I.buildIssueUrl(bundle({ errors: { byCode: {}, last: [] }, environment: { extensionVersion: '0.1.0', browser: { name: 'Opera' } } })).fields;
      ok(f.title.startsWith('[report] '));
      eq(f.browser, 'Other');
    });
    it('long descriptions are trimmed to fit the URL limit; the report id is never dropped', () => {
      const r = I.buildIssueUrl(bundle({ description: 'x '.repeat(20000) }));
      ok(r.url.length <= I.MAX_URL, String(r.url.length));
      eq(params(r.url).report_id, 'R-20261118-7KQ2D');
      ok(r.fields.title.endsWith('(R-20261118-7KQ2D)'));
    });
  });

  describe('issue reports › GitHub lookups and status', () => {
    it('similar reports search: open issues with the code in the title', () => {
      const u = decodeURIComponent(I.similarSearchUrl(['AJP-AI-429', 'AJP-JD-NONE']));
      includes(u, 'repo:samberchmans-games/apply-job-plugin is:issue is:open "AJP-AI-429" in:title');
      eq(I.similarSearchUrl([]), null);
    });
    it('status search by report id', () => includes(decodeURIComponent(I.statusSearchUrl('R-20261118-7KQ2D')), '"R-20261118-7KQ2D" in:title'));
    const issue = (state, labels) => ({ number: 42, html_url: 'https://github.com/x/42', state, labels: labels.map((name) => ({ name })) });
    for (const [state, labels, expected] of [
      ['open', ['bug', 'needs-triage'], 'received'],
      ['open', ['needs-info'], 'needs-info'],
      ['open', ['confirmed'], 'fixing'],
      ['open', ['in-progress'], 'fixing'],
      ['closed', ['fixed-in:v0.2.0'], 'fixed'],
      ['closed', ['duplicate'], 'duplicate'],
      ['closed', ['wont-fix'], 'wont-fix'],
      ['closed', [], 'closed'],
    ]) it(`${state} + [${labels}] → ${expected}`, () => eq(I.statusFromIssue(issue(state, labels)).status, expected));
    it('fixed carries the version and issue number', () => eq(I.statusFromIssue(issue('closed', ['fixed-in:v0.2.0'])), { number: 42, url: 'https://github.com/x/42', status: 'fixed', version: 'v0.2.0' }));
    it('no issue found → not submitted', () => eq(I.statusFromIssue(undefined).status, 'not-submitted'));
    it('every status has user-facing text', () => {
      for (const s of ['not-submitted', 'received', 'needs-info', 'fixing', 'fixed', 'duplicate', 'wont-fix', 'closed', 'unknown']) ok(I.STATUS_TEXT[s], s);
    });
  });

  describe('issue reports › crash prompt rules', () => {
    const err = (code) => ({ lvl: 'error', code, msg: 'x' });
    const T0 = Date.parse('2026-11-18T10:00:00Z');
    it('AJP-INTERNAL and AJP-STORE prompt immediately', () => {
      ok(I.shouldPrompt({}, err('AJP-INTERNAL'), { now: T0 }).prompt);
      ok(I.shouldPrompt({}, err('AJP-STORE'), { now: T0 }).prompt);
    });
    it('another code prompts on its 3rd time within 10 minutes', () => {
      let st = {};
      const r = [0, 60000, 120000].map((d) => {
        const x = I.shouldPrompt(st, err('AJP-AI-5XX'), { now: T0 + d });
        st = x.state;
        return x.prompt;
      });
      eq(r, [false, false, true]);
    });
    it('3 times spread over more than 10 minutes does not prompt', () => {
      let st = {};
      let last;
      for (const d of [0, 6, 12].map((m) => m * 60000)) {
        last = I.shouldPrompt(st, err('AJP-AI-5XX'), { now: T0 + d });
        st = last.state;
      }
      notOk(last.prompt);
    });
    it('at most once per code per day', () => {
      const a = I.shouldPrompt({}, err('AJP-INTERNAL'), { now: T0 });
      notOk(I.shouldPrompt(a.state, err('AJP-INTERNAL'), { now: T0 + 3600000 }).prompt);
      ok(I.shouldPrompt(a.state, err('AJP-INTERNAL'), { now: T0 + 25 * 3600000 }).prompt);
    });
    it('"don\'t ask again" for a code is respected', () => notOk(I.shouldPrompt({ never: { 'AJP-INTERNAL': true } }, err('AJP-INTERNAL'), { now: T0 }).prompt));
    it('the setting turns prompts off', () => notOk(I.shouldPrompt({}, err('AJP-INTERNAL'), { now: T0, enabled: false }).prompt));
    it('problems the user can fix themselves never prompt (AI off, wrong key, rate limit, no JD…)', () => {
      for (const c of ['AJP-AI-OFF', 'AJP-AI-401', 'AJP-AI-429', 'AJP-JD-NONE', 'AJP-RES-STRUCT']) {
        let st = {};
        let r;
        for (let i = 0; i < 5; i++) {
          r = I.shouldPrompt(st, err(c), { now: T0 + i });
          st = r.state;
        }
        notOk(r.prompt, c);
      }
    });
    it('warnings and errors without a code never prompt', () => {
      notOk(I.shouldPrompt({}, { lvl: 'warn', code: 'AJP-INTERNAL' }, { now: T0 }).prompt);
      notOk(I.shouldPrompt({}, { lvl: 'error' }, { now: T0 }).prompt);
    });
  });
})();
