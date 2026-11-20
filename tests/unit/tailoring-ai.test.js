/*
 * Resume tailoring with a free Groq or Gemini key: a separate AI for tailoring, waiting out a free-tier rate limit
 * once, and asking again when the AI returns too few requirements.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, rejects, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  let realFetch;
  let calls;
  const ok200 = (content) => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }));
  const limited = (msg) => new Response(JSON.stringify({ error: { message: msg } }), { status: 429 });
  function fake(...replies) {
    calls = [];
    let i = 0;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
      const r = replies[Math.min(i++, replies.length - 1)];
      return typeof r === 'function' ? r() : r;
    };
  }
  const JD = 'Requirements\n- AWS\n- AWS Glue\n- Snowflake\n- Python\n- Kafka\n- Airflow';
  const REQ = (n) => ({ requirements: Array.from({ length: n }, (_, i) => ({ id: 'R' + (i + 1), text: 'req ' + (i + 1), priority: 'must', match: 'none', evidence: [] })), ats_keywords: [] });
  const saved = {};

  async function before() {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.ai.CONFIG);
    AJP.ai.CONFIG.tries = 1;
    AJP.ai.CONFIG.patienceMs = 3000;
  }
  function after() {
    globalThis.fetch = realFetch;
    Object.assign(AJP.ai.CONFIG, saved);
  }
  const settings = (ai) => AJP.store.update('settings', (s) => void Object.assign(s.ai, ai));

  describe('tailoring ai › a separate AI for tailoring', () => {
    beforeEach(before);
    afterEach(after);
    it('everyday tasks use the main provider, tailoring uses the tailoring provider (its own default model)', async () => {
      await settings({ provider: 'openrouter', model: 'some/other-model', tailorProvider: 'groq', keys: { groq: 'gsk', gemini: '', openrouter: 'or' } });
      fake(ok200('OK'), ok200(REQ(6)));
      await AJP.ai.tasks.test();
      await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      includes(calls[0].url, 'openrouter.ai');
      includes(calls[1].url, 'api.groq.com');
      eq(calls[1].body.model, AJP.ai.PROVIDERS.groq.defaultModel, 'not the Model field of the main provider');
    });
    it('Gemini for tailoring works the same way', async () => {
      await settings({ provider: 'groq', tailorProvider: 'gemini', keys: { groq: 'gsk', gemini: 'g', openrouter: '' } });
      fake(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(REQ(6)) }] } }] })));
      eq((await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' })).requirements.length, 6);
      includes(calls[0].url, 'generativelanguage.googleapis.com');
    });
    it('no key for the tailoring provider → AJP-AI-KEY naming it', async () => {
      await settings({ provider: 'groq', tailorProvider: 'gemini', keys: { groq: 'gsk', gemini: '', openrouter: '' } });
      const e = await rejects(() => AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' }));
      eq([e.code, e.details.provider], ['AJP-AI-KEY', 'gemini']);
    });
    it('"Same as above" (empty) uses the main provider', async () => {
      await settings({ provider: 'groq', tailorProvider: '', keys: { groq: 'gsk', gemini: '', openrouter: '' } });
      fake(ok200(REQ(6)));
      await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      includes(calls[0].url, 'api.groq.com');
    });
    it('"Test tailoring AI" tests the tailoring provider', async () => {
      await settings({ provider: 'openrouter', tailorProvider: 'groq', keys: { groq: 'gsk', gemini: '', openrouter: 'or' } });
      fake(ok200('OK'));
      eq((await AJP.send('ai.test', { group: 'tailor' })).text, 'OK');
      includes(calls[0].url, 'api.groq.com');
    });
  }, { env: 'browser' });

  describe('tailoring ai › free-tier rate limits', () => {
    beforeEach(async () => {
      await before();
      await settings({ provider: 'groq', tailorProvider: '', keys: { groq: 'gsk', gemini: '', openrouter: '' } });
    });
    afterEach(after);
    it('"try again in 1.2s" during tailoring → waits, retries once, succeeds', async () => {
      fake(limited('Rate limit reached for model llama-3.3-70b-versatile in tokens per minute (TPM). Please try again in 1.2s.'), ok200(REQ(6)));
      const t = Date.now();
      eq((await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' })).requirements.length, 6);
      eq(calls.length, 2);
      ok(Date.now() - t >= 1200, 'waited');
    });
    it('a wait longer than the patience limit → the coded rate-limit error', async () => {
      fake(limited('Please try again in 2m10.5s.'));
      eq((await rejects(() => AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' }))).code, 'AJP-AI-429');
      eq(calls.length, 1);
    });
    it('everyday tasks are not kept waiting (no patience outside tailoring)', async () => {
      fake(limited('Please try again in 1.2s.'), ok200('OK'));
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-429');
    });
  }, { env: 'browser' });

  describe('tailoring ai › too few requirements', () => {
    beforeEach(async () => {
      await before();
      await settings({ provider: 'groq', tailorProvider: '', keys: { groq: 'gsk', gemini: '', openrouter: '' } });
    });
    afterEach(after);
    it('1 requirement for a job naming 6 skills → asked again once, the fuller answer is used', async () => {
      fake(ok200(REQ(1)), ok200(REQ(7)));
      const r = await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      eq(r.requirements.length, 7);
      eq(calls.length, 2);
      includes(calls[1].body.messages[1].content, 'listed only 1 requirement');
    });
    it('if the second answer is not better, the first is kept', async () => {
      fake(ok200(REQ(2)), ok200(REQ(1)));
      eq((await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' })).requirements.length, 2);
    });
    it('a short job (few skills) is not asked again', async () => {
      fake(ok200(REQ(1)));
      await AJP.ai.tasks.analyzeForResume({ jd: 'Requirements\n- Python', resumeText: '- x' });
      eq(calls.length, 1);
    });
    it('the prompt asks for 6–15 separate requirements and to split combined ones', () => {
      const p = AJP.resumeEngine.analyzePrompt({ jd: JD, resumeText: '- x' }).prompt;
      includes(p, 'Return 6 to 15 requirements');
      includes(p, '"AWS, AWS Glue and Snowflake" = three requirements');
    });
  }, { env: 'browser' });
})();
