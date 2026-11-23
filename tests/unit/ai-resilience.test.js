/*
 * Free AI fails in ordinary ways: a stream stops halfway, one model cuts off or breaks JSON, a provider is busy for a few
 * minutes, a daily quota runs out. One bad moment must not bench a good model for hours or end a job another model can do.
 * Every call is faked: no real network.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, rejects } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  let realFetch;
  let calls;
  const saved = {};
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
  const said = (content, finish = 'stop') => json({ choices: [{ message: { content }, finish_reason: finish }] });
  const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const piece = (content, finish = null) => ({ choices: [{ delta: { content }, finish_reason: finish }] });
  function fake(...replies) {
    calls = [];
    globalThis.fetch = async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      calls.push({ url: String(url), model: body.model });
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof r === 'function' ? r() : r;
    };
  }
  const health = (provider, models, extra = {}) => AJP.store.set('modelHealth', { [provider]: { ranked: models, at: Date.now(), rankV: AJP.ai.models.RANK_VERSION, ...extra } });
  const setup = (provider) => AJP.store.update('settings', (s) => void Object.assign(s.ai, { provider, model: '', tailorProvider: '', tailorModel: '', resolvedModels: {}, keys: { ...s.ai.keys, [provider]: 'test-key' } }));
  async function before() {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.ai.CONFIG);
    Object.assign(AJP.ai.CONFIG, { tries: 1, pacing: false });
  }
  function after() {
    globalThis.fetch = realFetch;
    Object.assign(AJP.ai.CONFIG, saved);
  }
  const ask = (o = {}) => AJP.ai.complete({ system: 's', prompt: 'p', task: 'x', ...o });

  describe('ai resilience › one model failing does not end the job', () => {
    beforeEach(async () => {
      await before();
      await setup('groq');
      await health('groq', ['model-a', 'model-b']);
    });
    afterEach(after);
    it('a stream that stops halfway is not taken as the answer', async () => {
      fake(sse([piece('Half an ans')]), said('Whole answer'));
      eq(await ask(), 'Whole answer');
      eq(calls.map((c) => c.model), ['model-a', 'model-b']);
    });
    it('a complete stream is the answer', async () => {
      fake(sse([piece('All '), piece('here', 'stop')]));
      eq(await ask(), 'All here');
    });
    it('complete JSON is kept even if the stream ended without a finish marker', async () => {
      fake(sse([piece('{"a":1}')]));
      eq(await ask({ json: true }), { a: 1 });
    });
    it('a model that keeps cutting off: the next model answers', async () => {
      fake(said('{"a":', 'length'), said('{"a":', 'length'), said('{"a":2}'));
      eq(await ask({ json: true }), { a: 2 });
      eq(calls[calls.length - 1].model, 'model-b');
    });
    it('a model that breaks JSON twice: the next model answers', async () => {
      fake(said('not json'), said('still not json'), said('{"ok":true}'));
      eq(await ask({ json: true }), { ok: true });
      eq(calls.map((c) => c.model), ['model-a', 'model-a', 'model-b']);
    });
    it('an empty answer: the next model answers', async () => {
      fake(said(''), said('Answer'));
      eq(await ask(), 'Answer');
    });
    it('"Check my AI setup" still tests the exact model', async () => {
      fake(said('bad'), said('bad'));
      await rejects(() => ask({ json: true, via: 'groq', exactModel: 'model-a' }));
      eq([...new Set(calls.map((c) => c.model))], ['model-a']);
    });
  }, { env: 'browser' });

  describe('ai resilience › a bad moment is not a long penalty', () => {
    beforeEach(async () => {
      await before();
      await setup('groq');
      await health('groq', ['model-a', 'model-b']);
    });
    afterEach(after);
    const until = async (m) => (await AJP.store.get('modelHealth')).groq.bad[m] - Date.now();
    it('first server error: set aside for minutes, not an hour', async () => {
      fake(json({ error: { message: 'overloaded' } }, 503), said('ok'));
      await ask();
      ok((await until('model-a')) <= 5 * 60000);
    });
    it('failing again and again: set aside longer', async () => {
      await health('groq', ['model-a', 'model-b'], { strikes: { 'model-a': { n: 2, at: Date.now() } } });
      fake(json({ error: { message: 'overloaded' } }, 503), said('ok'));
      await ask();
      ok((await until('model-a')) > 15 * 60000);
    });
    it('a success clears the record', async () => {
      await health('groq', ['model-a'], { strikes: { 'model-a': { n: 3, at: Date.now() } } });
      fake(said('ok'));
      await ask();
      notOk(((await AJP.store.get('modelHealth')).groq.strikes || {})['model-a']);
    });
  }, { env: 'browser' });

  describe('ai resilience › when a daily quota resets', () => {
    it('Gemini daily quota resets at midnight Pacific', () => {
      const next = AJP.ai.models.nextPacificMidnight;
      eq(new Date(next(Date.parse('2026-11-23T07:30:00Z'))).toISOString(), '2026-11-23T08:00:00.000Z', 'winter');
      eq(new Date(next(Date.parse('2026-07-01T06:30:00Z'))).toISOString(), '2026-07-01T07:00:00.000Z', 'summer');
    });
  });

  describe('ai resilience › free daily limits', () => {
    beforeEach(before);
    afterEach(after);
    it('OpenRouter daily cap: stops at once, says what happened', async () => {
      await setup('openrouter');
      await health('openrouter', ['a:free', 'b:free']);
      fake(json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day.' } }, 429));
      const e = await ask().catch((x) => x);
      eq([e.code, calls.length], ['AJP-AI-429', 1]);
      includes(e.hint, 'daily');
    });
  }, { env: 'browser' });

  describe('ai resilience › Check my AI setup', () => {
    beforeEach(before);
    afterEach(after);
    const listed = (ids) => json({ data: ids.map((id) => ({ id })) });
    it('a busy provider does not erase a model that was verified', async () => {
      await setup('groq');
      await health('groq', ['good'], { verified: { good: Date.now() } });
      globalThis.fetch = async (url) => (/models$/.test(url) ? listed(['good']) : json({ error: { message: 'overloaded' } }, 503));
      const r = await AJP.aiCheck.run('groq');
      eq([r.status, r.temporary], ['failed', true]);
      ok((await AJP.store.get('modelHealth')).groq.verified.good);
    });
    it('a busy provider is still offered as "Try with"', async () => {
      await AJP.store.update('settings', (s) => void Object.assign(s.ai, { provider: 'gemini', keys: { gemini: 'k', groq: 'k' } }));
      await AJP.store.set('aiChecks', { groq: { status: 'failed', temporary: true } });
      eq((await AJP.ai.alternatives()).options.map((o) => o.id), ['groq']);
    });
    it('a rejected key clears the verified models', async () => {
      await setup('groq');
      await health('groq', ['good'], { verified: { good: Date.now() } });
      globalThis.fetch = async () => json({ error: { message: 'Invalid API Key' } }, 401);
      await AJP.aiCheck.run('groq');
      eq((await AJP.store.get('modelHealth')).groq.verified, {});
    });
    it('OpenRouter: the check stops at the daily cap (failed calls count against it)', async () => {
      await setup('openrouter');
      let chats = 0;
      globalThis.fetch = async (url) => {
        if (/models$/.test(url)) return listed(['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free', 'qwen/qwen3-32b:free']);
        chats++;
        return json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day.' } }, 429);
      };
      await AJP.aiCheck.run('openrouter');
      eq(chats, 1);
    });
  }, { env: 'browser' });
})();
