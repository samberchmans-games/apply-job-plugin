(function () {
  const { describe, it, eq, ok, includes, excludes, throws, rejects, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;

  describe('ai › JSON parsing of model output', () => {
    it('parses plain JSON', () => eq(AJP.ai.parseJsonLoose('{"a":1}'), { a: 1 }));
    it('parses JSON inside ```json fences', () => eq(AJP.ai.parseJsonLoose('```json\n{"a":[1,2]}\n```'), { a: [1, 2] }));
    it('parses JSON surrounded by chatter', () => eq(AJP.ai.parseJsonLoose('Sure! Here it is: {"ok":true} Hope that helps.'), { ok: true }));
    it('throws a coded error when there is no JSON', () => eq(throws(() => AJP.ai.parseJsonLoose('no json here')).code, 'AJP-AI-FMT'));
    it('throws a coded error for broken JSON', () => eq(throws(() => AJP.ai.parseJsonLoose('{"a": oops}')).code, 'AJP-AI-FMT'));
    it('every provider except "none" has a default model', () => {
      for (const [k, p] of Object.entries(AJP.ai.PROVIDERS)) if (k !== 'none') ok(p.defaultModel, k);
    });
  });

  // ---- Provider calls with a fake fetch ----------------------------------------
  let realFetch;
  let calls;
  const respond = (body, status = 200) => async (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  const setProvider = (provider, extra = {}) =>
    AJP.store.update('settings', (s) => {
      s.ai.provider = provider;
      s.ai.keys = { gemini: 'g-key', groq: 'gsk-key', openrouter: 'or-key' };
      Object.assign(s.ai, extra);
    });
  const OPENAI_OK = { choices: [{ message: { content: 'OK' } }] };

  describe('ai › providers', () => {
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
      calls = [];
      AJP.ai.CONFIG.tries = 1; // retries are covered in standard.test.js
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      AJP.ai.CONFIG.timeoutMs = 90000;
      AJP.ai.CONFIG.tries = 3;
    });

    it('refuses when AI is off, with guidance (AJP-AI-OFF)', async () => {
      const e = await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }), /AI is turned off/);
      eq(e.code, 'AJP-AI-OFF');
      includes(e.hint, 'Admin → AI settings');
    });
    it('refuses when the API key is missing (AJP-AI-KEY)', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.provider = 'groq'));
      eq((await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }), /No API key saved/)).code, 'AJP-AI-KEY');
    });
    it('Gemini: correct URL, key in header (not URL), system + user parts', async () => {
      await setProvider('gemini');
      globalThis.fetch = respond({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
      eq(await AJP.ai.complete({ system: 'SYS', prompt: 'USER' }), 'OK');
      includes(calls[0].url, 'generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      excludes(calls[0].url, 'g-key');
      eq(calls[0].opts.headers['x-goog-api-key'], 'g-key');
      eq(calls[0].body.systemInstruction.parts[0].text, 'SYS');
      eq(calls[0].body.contents[0].parts[0].text, 'USER');
    });
    it('Gemini JSON mode sets responseMimeType', async () => {
      await setProvider('gemini');
      globalThis.fetch = respond({ candidates: [{ content: { parts: [{ text: '{"x":1}' }] } }] });
      eq(await AJP.ai.complete({ system: 's', prompt: 'p', json: true }), { x: 1 });
      eq(calls[0].body.generationConfig.responseMimeType, 'application/json');
    });
    it('Groq: OpenAI-style request with Bearer key and default model', async () => {
      await setProvider('groq');
      globalThis.fetch = respond(OPENAI_OK);
      eq(await AJP.ai.complete({ system: 's', prompt: 'p' }), 'OK');
      eq(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
      eq(calls[0].opts.headers.Authorization, 'Bearer gsk-key');
      eq(calls[0].body.model, 'llama-3.3-70b-versatile');
      eq(calls[0].body.messages.map((m) => m.role), ['system', 'user']);
    });
    it('OpenRouter: uses the configured custom model', async () => {
      await setProvider('openrouter', { model: 'some/model:free' });
      globalThis.fetch = respond(OPENAI_OK);
      await AJP.ai.complete({ system: 's', prompt: 'p' });
      eq(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      eq(calls[0].body.model, 'some/model:free');
    });
    it('Ollama: local URL, no key, stream off', async () => {
      await setProvider('ollama', { ollamaUrl: 'http://localhost:11434/' });
      globalThis.fetch = respond({ message: { content: 'OK' } });
      eq(await AJP.ai.complete({ system: 's', prompt: 'p' }), 'OK');
      eq(calls[0].url, 'http://localhost:11434/api/chat');
      eq(calls[0].body.stream, false);
    });
    for (const [status, code] of [[401, 'AJP-AI-401'], [403, 'AJP-AI-401'], [429, 'AJP-AI-429'], [404, 'AJP-AI-404'], [500, 'AJP-AI-5XX'], [503, 'AJP-AI-5XX'], [400, 'AJP-AI-HTTP']]) {
      it(`HTTP ${status} → ${code} with status and provider body kept for support`, async () => {
        await setProvider('groq');
        globalThis.fetch = respond('{"error":"provider says no"}', status);
        const e = await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }));
        eq([e.code, e.details.status], [code, status]);
        includes(e.details.body, 'provider says no');
        ok(e.hint);
      });
    }
    it('network failures → AJP-AI-NET', async () => {
      await setProvider('groq');
      globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
      const e = await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }));
      eq([e.code, e.details.original, e.details.host], ['AJP-AI-NET', 'Failed to fetch', 'api.groq.com']);
    });
    it('slow providers time out → AJP-AI-TIME', async () => {
      await setProvider('groq');
      AJP.ai.CONFIG.timeoutMs = 50;
      globalThis.fetch = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      eq((await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }), /too long/)).code, 'AJP-AI-TIME');
    });
    it('an empty answer → AJP-AI-FMT', async () => {
      await setProvider('groq');
      globalThis.fetch = respond({ choices: [{ message: { content: '   ' } }] });
      eq((await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }))).code, 'AJP-AI-FMT');
    });
    it('a non-JSON provider response → AJP-AI-FMT', async () => {
      await setProvider('groq');
      globalThis.fetch = respond('<html>gateway</html>');
      eq((await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p' }))).code, 'AJP-AI-FMT');
    });
    it('failed calls are logged without the API key', async () => {
      await setProvider('groq');
      const got = [];
      const saved = AJP.getLogSink();
      AJP.setLogSink(async (e) => got.push(...e));
      globalThis.fetch = respond('nope', 500);
      await rejects(() => AJP.ai.complete({ system: 's', prompt: 'p', task: 'unitTask' }));
      await AJP.flushLogs();
      AJP.setLogSink(saved);
      const e = got.find((x) => x.lvl === 'error' && x.msg.includes('unitTask'));
      ok(e, 'error entry logged');
      eq(e.code, 'AJP-AI-5XX');
      ok(e.tid, 'has a trace id');
      excludes(JSON.stringify(got), 'gsk-key');
    });
  }, { env: 'browser' });

  describe('ai › prompts (truthfulness & privacy)', () => {
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
      calls = [];
      await setProvider('groq');
      globalThis.fetch = respond({ choices: [{ message: { content: '{"ok":true}' } }] }); // valid for text and JSON tasks
    });
    afterEach(() => (globalThis.fetch = realFetch));

    const profile = () => {
      const p = AJP.clone(AJP.store.DEFAULTS.profile);
      p.personal.firstName = 'Ana';
      p.skills = [{ name: 'Python', years: 5, level: 'expert' }];
      p.autoApply.eeo = { gender: 'Female', race: 'UNIQUE_RACE_VALUE', hispanic: 'No', veteran: 'UNIQUE_VET_VALUE', disability: 'UNIQUE_DIS_VALUE', pronouns: '' };
      return p;
    };
    const allText = () => JSON.stringify(calls.map((c) => c.body));

    it('draftAnswer uses only resume/profile facts and placeholders', async () => {
      await AJP.ai.tasks.draftAnswer({ question: 'Why us?', jd: 'JD', resumeText: 'R', profile: profile(), job: { title: 'Dev' }, maxWords: 50 });
      includes(allText(), 'Never invent facts');
      includes(allText(), 'at most 50 words');
    });
    it('EEO answers are NEVER sent to the AI', async () => {
      const p = profile();
      await AJP.ai.tasks.analyzeForResume({ jd: 'JD', resumeText: 'R' });
      await AJP.ai.tasks.draftAnswer({ question: 'Q', jd: 'JD', resumeText: 'R', profile: p, job: {} });
      await AJP.ai.tasks.extractSkills({ jd: 'JD' });
      for (const v of ['UNIQUE_RACE_VALUE', 'UNIQUE_VET_VALUE', 'UNIQUE_DIS_VALUE']) excludes(allText(), v);
    });
    it('very long inputs are truncated', async () => {
      await AJP.ai.tasks.extractSkills({ jd: 'x'.repeat(50000) });
      ok(calls[0].body.messages[1].content.length < 15000);
      includes(calls[0].body.messages[1].content, '[truncated]');
    });
  }, { env: 'browser' });
})();
