/*
 * More AI providers: Anthropic Claude (paid, optional, bring your own key), NVIDIA NIM and Mistral (free keys).
 * Every call is faked: no real network, no charges.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, rejects } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  let realFetch;
  let calls;
  const saved = {};
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
  const claude = (text, extra = {}) => json({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], stop_reason: 'end_turn', ...extra });
  const openai = (content) => json({ choices: [{ message: { content } }] });
  function fake(...replies) {
    calls = [];
    let i = 0;
    globalThis.fetch = async (url, opts) => {
      const h = (opts && opts.headers) || {};
      calls.push({ url: String(url), headers: h instanceof Headers ? Object.fromEntries(h.entries()) : h, body: opts && opts.body ? JSON.parse(opts.body) : null });
      const r = replies[Math.min(i++, replies.length - 1)];
      return typeof r === 'function' ? r() : r;
    };
  }
  async function before() {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.ai.CONFIG);
    AJP.ai.CONFIG.tries = 1;
  }
  function after() {
    globalThis.fetch = realFetch;
    Object.assign(AJP.ai.CONFIG, saved);
  }
  const settings = (ai) => AJP.store.update('settings', (s) => void Object.assign(s.ai, ai));
  const KEYS = { gemini: '', groq: '', openrouter: '', nvidia: 'nvapi-test', mistral: 'mis-test', anthropic: 'sk-ant-test' };
  const REQ = { requirements: Array.from({ length: 6 }, (_, i) => ({ id: 'R' + i, text: 'r' + i, priority: 'must', match: 'none', evidence: [] })), ats_keywords: [] };
  const JD = 'Requirements\n- AWS\n- Snowflake\n- Python\n- Kafka\n- Airflow\n- dbt';

  describe('providers › Anthropic Claude (paid, optional)', () => {
    beforeEach(async () => {
      await before();
      await settings({ provider: 'anthropic', model: '', tailorProvider: '', tailorModel: '', resolvedModels: {}, keys: { ...KEYS } });
    });
    afterEach(after);
    it('is listed as paid, with Claude Opus 5.5 as its default model', () => {
      const p = AJP.ai.PROVIDERS.anthropic;
      eq([p.paid, p.needsKey, p.defaultModel], [true, true, 'claude-opus-5-5']);
      includes(p.label, 'paid');
    });
    it('calls the Messages API with the key, version and browser-access headers; returns only the text blocks', async () => {
      fake(claude('OK'));
      eq(await AJP.ai.tasks.test(), 'OK', 'the empty thinking block is ignored');
      eq(calls[0].url, 'https://api.anthropic.com/v1/messages');
      eq([calls[0].headers['x-api-key'], calls[0].headers['anthropic-version'], calls[0].headers['anthropic-dangerous-direct-browser-access']], ['sk-ant-test', '2023-06-01', 'true']);
      eq([calls[0].body.model, calls[0].body.max_tokens, calls[0].body.messages[0].role], ['claude-opus-5-5', 16000, 'user']);
      notOk('temperature' in calls[0].body, 'no sampling parameters');
    });
    it('Opus 5.5 gets the server-side refusal fallback; Haiku 5.5 (no fallback support) does not', async () => {
      fake(claude('OK'));
      await AJP.ai.tasks.test();
      eq([calls[0].body.fallbacks, calls[0].headers['anthropic-beta']], ['default', 'server-side-fallback-2026-07-01']);
      await settings({ model: 'claude-haiku-5-5' });
      fake(claude('OK'));
      await AJP.ai.tasks.test();
      eq([calls[0].body.model, 'fallbacks' in calls[0].body, 'anthropic-beta' in calls[0].headers], ['claude-haiku-5-5', false, false]);
    });
    it('JSON tasks ask for JSON in the system prompt and parse the reply', async () => {
      fake(claude(JSON.stringify(REQ)));
      eq((await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' })).requirements.length, 6);
      includes(calls[0].body.system, 'ONE valid JSON object');
    });
    it('a safety refusal → AJP-AI-REFUSED (not an empty answer)', async () => {
      fake(json({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }));
      const e = await rejects(() => AJP.ai.tasks.test());
      eq([e.code, e.details.category], ['AJP-AI-REFUSED', 'cyber']);
    });
    it('"credit balance is too low" → AJP-AI-CREDIT with a pointer to billing and the free providers, no retry', async () => {
      AJP.ai.CONFIG.tries = 3;
      fake(json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }, 400));
      const e = await rejects(() => AJP.ai.tasks.test());
      eq(e.code, 'AJP-AI-CREDIT');
      includes(e.hint, 'console.anthropic.com');
      includes(e.hint, 'Groq');
      eq(calls.length, 1);
    });
    it('a wrong key → AJP-AI-401', async () => {
      fake(json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401));
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-401');
    });
    it('no key → AJP-AI-KEY naming Anthropic', async () => {
      await settings({ keys: { ...KEYS, anthropic: '' } });
      const e = await rejects(() => AJP.ai.tasks.test());
      eq([e.code, e.details.provider], ['AJP-AI-KEY', 'anthropic']);
    });
    it('a retired model → reads /v1/models, picks the best Claude model offered, remembers it', async () => {
      fake(json({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-opus-5-5' } }, 404),
        json({ data: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }] }), claude('OK'));
      eq(await AJP.ai.tasks.test(), 'OK');
      includes(calls[1].url, 'api.anthropic.com/v1/models');
      eq(calls[1].headers['x-api-key'], 'sk-ant-test');
      eq(calls[2].body.model, 'claude-sonnet-5-5');
      eq((await AJP.store.get('modelHealth')).anthropic.last, 'claude-sonnet-5-5');
    });
    it('Recent AI calls name it "Anthropic Claude · model"', async () => {
      fake(claude('OK'));
      await AJP.ai.tasks.test();
      eq((await AJP.store.get('aiCalls'))[0].label, 'Anthropic Claude · claude-opus-5-5');
    });
  }, { env: 'browser' });

  describe('providers › Claude only for tailoring, with its own model', () => {
    beforeEach(async () => {
      await before();
      await settings({ provider: 'groq', model: 'llama-x', tailorProvider: 'anthropic', tailorModel: '', resolvedModels: {}, keys: { ...KEYS, groq: 'gsk' } });
    });
    afterEach(after);
    it('everyday tasks stay on the free provider; tailoring goes to Claude', async () => {
      fake(openai('OK'), claude(JSON.stringify(REQ)));
      await AJP.ai.tasks.test();
      await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      includes(calls[0].url, 'api.groq.com');
      includes(calls[1].url, 'api.anthropic.com');
      eq(calls[1].body.model, 'claude-opus-5-5', 'the main Model field does not leak into tailoring');
    });
    it('"Tailoring model" picks a cheaper Claude model for tailoring only', async () => {
      await settings({ tailorModel: 'claude-haiku-5-5' });
      fake(claude(JSON.stringify(REQ)), openai('OK'));
      await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      await AJP.ai.tasks.test();
      eq([calls[0].body.model, calls[1].body.model], ['claude-haiku-5-5', 'llama-x']);
    });
  }, { env: 'browser' });

  describe('providers › NVIDIA NIM and Mistral (free keys)', () => {
    beforeEach(async () => {
      await before();
      await settings({ model: '', tailorProvider: '', tailorModel: '', resolvedModels: {}, keys: { ...KEYS } });
    });
    afterEach(after);
    it('NVIDIA: OpenAI-style call with its key and default model; JSON asked in the prompt, not response_format', async () => {
      await settings({ provider: 'nvidia' });
      fake(openai('Here you go: ' + JSON.stringify(REQ)));
      eq((await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' })).requirements.length, 6);
      eq(calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
      eq(calls[0].headers.Authorization, 'Bearer nvapi-test');
      eq(calls[0].body.model, 'meta/llama-3.3-70b-instruct');
      notOk('response_format' in calls[0].body);
      includes(calls[0].body.messages[0].content, 'ONE valid JSON object');
    });
    it('Mistral: OpenAI-style call with JSON mode', async () => {
      await settings({ provider: 'mistral' });
      fake(openai(JSON.stringify(REQ)));
      await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      eq(calls[0].url, 'https://api.mistral.ai/v1/chat/completions');
      eq([calls[0].headers.Authorization, calls[0].body.model, calls[0].body.response_format.type], ['Bearer mis-test', 'mistral-medium-latest', 'json_object']);
    });
    it('NVIDIA: a retired model is replaced from its model list (skipping non-chat models)', async () => {
      await settings({ provider: 'nvidia' });
      fake(json({ error: 'Function not found for account' }, 404),
        json({ data: [{ id: 'nvidia/nv-embedqa-e5-v5' }, { id: 'nvidia/llama-3.1-nemoguard-8b-content-safety' }, { id: 'openai/gpt-oss-120b' }] }), openai('OK'));
      eq(await AJP.ai.tasks.test(), 'OK');
      eq(calls[2].body.model, 'openai/gpt-oss-120b');
    });
    it('Mistral: a free-plan rate limit is an ordinary AJP-AI-429', async () => {
      await settings({ provider: 'mistral' });
      fake(json({ message: 'Requests rate limit exceeded' }, 429));
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-429');
    });
  }, { env: 'browser' });

  describe('providers › OpenRouter free models', () => {
    beforeEach(async () => {
      await before();
      await settings({ provider: 'openrouter', model: '', tailorProvider: '', tailorModel: '', resolvedModels: {}, keys: { ...KEYS, openrouter: 'sk-or-v1-test' } });
    });
    afterEach(after);
    const LIST = () => json({ data: [{ id: 'inclusionai/ling-3.2-flash:free' }, { id: 'anthropic/claude-opus-5-5' }, { id: 'openai/gpt-oss-120b:free' }, { id: 'meta-llama/llama-3.3-70b-instruct:free' }] });
    const busy = (m) => json({ error: { message: 'Provider returned error', code: 429, metadata: { raw: `${m} is temporarily rate-limited upstream. Please retry shortly, or add your own provider key to use your own limits` } } }, 429);
    it('a retired default → a capable free model, not a small "flash" one and never a paid one', async () => {
      await settings({ model: 'old/model:free' });
      fake(json({ error: { message: 'No endpoints found for old/model:free' } }, 404), LIST(), openai('OK'));
      eq(await AJP.ai.tasks.test(), 'OK');
      eq(calls[2].body.model, 'meta-llama/llama-3.3-70b-instruct:free');
    });
    it('a free model busy upstream → the next model by itself (the reported AJP-AI-429), remembered', async () => {
      await AJP.store.set('modelHealth', { openrouter: { ranked: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free'], at: Date.now() } });
      await settings({ resolvedModels: { openrouter: 'inclusionai/ling-3.2-flash:free' } });
      fake(busy('inclusionai/ling-3.2-flash:free'), openai('OK'));
      eq(await AJP.ai.tasks.test(), 'OK');
      eq(calls[1].body.model, 'meta-llama/llama-3.3-70b-instruct:free', 'no model list needed: the shortlist is fresh');
      eq((await AJP.store.get('modelHealth')).openrouter.last, 'meta-llama/llama-3.3-70b-instruct:free', 'remembered');
      ok((await AJP.store.get('modelHealth')).openrouter.bad['inclusionai/ling-3.2-flash:free'] > Date.now(), 'busy one set aside for a while');
    });
    it('tries up to 3 models in one call, then AJP-AI-429', async () => {
      fake(busy('a'), LIST(), busy('b'), busy('c'));
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-429');
      eq(calls.length, 4, 'default, model list, 2 more models');
    });
    it('a model set aside is skipped next time; after its cooldown it gets another chance', async () => {
      await AJP.store.set('modelHealth', { openrouter: { ranked: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free'], at: Date.now(), bad: { 'meta-llama/llama-3.3-70b-instruct:free': Date.now() + 3600e3 } } });
      fake(openai('OK'));
      await AJP.ai.tasks.test();
      eq(calls[0].body.model, 'openai/gpt-oss-120b:free');
      await AJP.store.set('modelHealth', { openrouter: { ranked: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free'], at: Date.now(), bad: { 'meta-llama/llama-3.3-70b-instruct:free': Date.now() - 1 } } });
      await settings({ resolvedModels: {} });
      fake(openai('OK'));
      await AJP.ai.tasks.test();
      eq(calls[0].body.model, 'meta-llama/llama-3.3-70b-instruct:free');
    });
    it('an empty model list (provider hiccup) never wipes a good shortlist', async () => {
      await AJP.store.set('modelHealth', { openrouter: { ranked: ['openai/gpt-oss-120b:free'], at: 0 } });
      fake(json({ data: [] }));
      await AJP.ai.models.refreshAll();
      eq((await AJP.store.get('modelHealth')).openrouter.ranked, ['openai/gpt-oss-120b:free']);
    });
    it('the daily check refreshes the shortlist of the providers in use (model lists only, no AI usage)', async () => {
      fake(LIST());
      const r = await AJP.ai.models.refreshAll();
      eq(r.openrouter[0], 'meta-llama/llama-3.3-70b-instruct:free');
      excludes(r.openrouter.join(' '), 'anthropic/claude', 'never a paid model');
      includes(calls[0].url, 'openrouter.ai/api/v1/models');
      ok((await AJP.store.get('modelHealth')).openrouter.at > Date.now() - 5000);
    });
    it('your own daily free limit (not upstream) → AJP-AI-429, no model switch', async () => {
      fake(json({ error: { message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day', code: 429 } }, 429));
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-429');
      eq(calls.length, 1);
    });
  }, { env: 'browser' });

  describe('providers › Gemini model choice and timeouts (report R-20261121-XX1QF)', () => {
    beforeEach(async () => {
      await before();
      await settings({ provider: 'gemini', model: '', tailorProvider: '', tailorModel: '', resolvedModels: {}, keys: { ...KEYS, gemini: 'g' } });
    });
    afterEach(after);
    const notFound = () => json({ error: { code: 404, message: 'models/gemini-2.5-flash is not found for API version v1beta' } }, 404);
    const list = (...ids) => json({ models: ids.map((id) => ({ name: 'models/' + id, supportedGenerationMethods: ['generateContent'] })) });
    const ok = () => json({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
    const hang = () => (url, opts) => new Promise((res, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    it('default not offered → never a slow special model (deep research, robotics, live…), a flash model instead', async () => {
      fake(notFound(), list('deep-research-pro-preview-12-2026', 'gemini-robotics-er-1.5-preview', 'gemini-2.5-flash-live', 'gemini-3.1-flash-preview'), ok());
      eq(await AJP.ai.tasks.test(), 'OK');
      includes(calls[2].url, 'models/gemini-3.1-flash-preview:generateContent');
    });
    it('the default is a current model (gemini-2.5-flash is deprecated); a replacement is the newest flash', async () => {
      eq(AJP.ai.PROVIDERS.gemini.defaultModel, 'gemini-3.6-flash');
      fake(notFound(), list('gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.7-pro'), ok());
      await AJP.ai.tasks.test();
      includes(calls[2].url, 'models/gemini-3.7-flash:generateContent');
    });
    it('asks Gemini to think less (newer models think at a high level by default and can take over a minute)', async () => {
      for (const [model, want] of [['gemini-3.6-flash', { thinkingLevel: 'low' }], ['gemini-flash-latest', { thinkingLevel: 'low' }], ['gemini-2.5-flash', { thinkingBudget: 0 }], ['gemini-2.5-pro', { thinkingBudget: 128 }]]) {
        await settings({ model });
        fake(ok());
        await AJP.ai.tasks.test();
        eq(calls[0].body.generationConfig.thinkingConfig, want, model);
      }
    });
    it('a model that rejects the thinking setting is asked again without it, once', async () => {
      await settings({ model: 'gemini-flash-latest' });
      fake(json({ error: { code: 400, message: 'Thinking level is not supported for this model.', status: 'INVALID_ARGUMENT' } }, 400), ok());
      eq(await AJP.ai.tasks.test(), 'OK');
      notOk('thinkingConfig' in calls[1].body.generationConfig);
    });
    it('only slow / special models offered → the coded "model not found" error, not a long wait', async () => {
      fake(notFound(), list('deep-research-pro-preview-12-2026', 'veo-3.0-generate'));
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-404');
    });
    it('Test connection gives up after CONFIG.testTimeoutMs (not the 90 s of a tailoring call)', async () => {
      AJP.ai.CONFIG.testTimeoutMs = 60;
      AJP.ai.CONFIG.listTimeoutMs = 60;
      calls = [];
      globalThis.fetch = (url, opts) => (calls.push({ url }), hang()(url, opts));
      const t0 = performance.now();
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-TIME');
      ok(performance.now() - t0 < 2000, 'fast');
    });
    it('a slow model is set aside and the next one is tried in the same call', async () => {
      AJP.ai.CONFIG.testTimeoutMs = 60;
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.6-flash'], at: Date.now() } });
      await settings({ resolvedModels: { gemini: 'gemini-slow-model' } });
      calls = [];
      globalThis.fetch = (url, opts) => (calls.push({ url: String(url) }), /gemini-slow-model/.test(url) ? hang()(url, opts) : Promise.resolve(ok()));
      eq(await AJP.ai.tasks.test(), 'OK');
      includes(calls[1].url, 'models/gemini-3.6-flash:generateContent');
      ok((await AJP.store.get('modelHealth')).gemini.bad['gemini-slow-model'] > Date.now());
      eq((await AJP.store.get('modelHealth')).gemini.last, 'gemini-3.6-flash');
    });
    it('a server error on one model ("overloaded", AJP-AI-5XX) → the next model in the same call (the reported failure)', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.6-flash', 'gemini-flash-latest'], at: Date.now() } });
      await settings({ resolvedModels: { gemini: 'gemini-flash-latest' } });
      fake(json({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }, 503), ok);
      eq(await AJP.ai.tasks.test(), 'OK');
      includes(calls[1].url, 'models/gemini-3.6-flash:generateContent');
      eq((await AJP.store.get('modelHealth')).gemini.why['gemini-flash-latest'], 'busy');
      eq((await AJP.store.get('modelHealth')).gemini.last, 'gemini-3.6-flash', 'the working one is used first next time');
    });
    it('one model out of free quota (429, the reported failure) → the next model at once, set aside until it resets', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.8-flash', 'gemini-3.6-flash'], at: Date.now() } });
      fake(json({ error: { code: 429, message: 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash. Please retry in 41s.', status: 'RESOURCE_EXHAUSTED' } }, 429), ok);
      eq(await AJP.ai.tasks.test(), 'OK');
      includes(calls[1].url, 'models/gemini-3.6-flash:generateContent');
      const h = (await AJP.store.get('modelHealth')).gemini;
      eq(h.why['gemini-3.8-flash'], 'quota');
      ok(h.bad['gemini-3.8-flash'] > Date.now() + 30000 && h.bad['gemini-3.8-flash'] < Date.now() + 2 * 3600e3, 'until the quota resets, not a day');
    });
    it('a daily quota is set aside until tomorrow; a model not in the free tier ("limit: 0") is skipped too', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'], at: Date.now() } });
      fake(json({ error: { code: 429, message: 'Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit: 250, model: gemini-3.8-flash' } }, 429),
        json({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.7-flash' } }, 429), ok);
      eq(await AJP.ai.tasks.test(), 'OK');
      includes(calls[2].url, 'models/gemini-3.6-flash:generateContent');
      const h = (await AJP.store.get('modelHealth')).gemini;
      ok(h.bad['gemini-3.8-flash'] > Date.now() + 20 * 3600e3, 'daily → about a day');
      eq(h.why['gemini-3.7-flash'], 'quota');
    });
    it('tailoring (patient) tries another Gemini model before waiting out a per-minute limit', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.8-flash', 'gemini-3.6-flash'], at: Date.now() } });
      fake(json({ error: { code: 429, message: 'Resource exhausted. Please try again in 20s.' } }, 429), () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(REQ) }] } }] }));
      const t0 = performance.now();
      await AJP.ai.tasks.analyzeForResume({ jd: JD, resumeText: '- x' });
      ok(performance.now() - t0 < 2000, 'no 20 s wait');
      includes(calls[1].url, 'gemini-3.6-flash');
    });
    it('the model that worked goes first next time, even after Admin saves its copy of the settings (3.8 → 3.7 → 3.6 every time)', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'], at: Date.now() } });
      const q = (m) => json({ error: { code: 429, message: `Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: ${m}` } }, 429);
      fake(q('gemini-3.8-flash'), q('gemini-3.7-flash'), ok);
      await AJP.ai.tasks.test();
      eq(calls.length, 3);
      eq((await AJP.store.get('aiCalls'))[0].path, [{ model: 'gemini-3.8-flash', why: 'quota' }, { model: 'gemini-3.7-flash', why: 'quota' }], 'Recent AI calls shows the models tried first');
      const stale = AJP.clone(await AJP.store.get('settings')); // what Admin holds and saves before a test
      stale.ai.resolvedModels = {};
      await AJP.store.set('settings', stale);
      fake(ok);
      await AJP.ai.tasks.test();
      eq(calls.length, 1, 'straight to the working model');
      eq((await AJP.store.get('aiCalls'))[0].path, undefined, 'nothing tried first');
      includes(calls[0].url, 'gemini-3.6-flash');
      const h = (await AJP.store.get('modelHealth')).gemini;
      ok(h.bad['gemini-3.8-flash'] > Date.now() + 20 * 3600e3, 'not in the free tier → skipped for a day');
    });
    it('models that worked before rank above untried newer ones', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.8-flash', 'gemini-3.6-flash'], at: Date.now(), ok: { 'gemini-3.6-flash': Date.now() - 3600e3 } } });
      fake(ok);
      await AJP.ai.tasks.test();
      includes(calls[0].url, 'gemini-3.6-flash');
    });
    it('numbered stable flash models rank above the "-latest" alias', async () => {
      fake(list('gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.6-flash'));
      eq((await AJP.ai.models.rank({ keys: { gemini: 'g' } }, 'gemini')).slice(0, 3), ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest']);
    });
    it('a model the provider calls deprecated (HTTP 400/410) is replaced too', async () => {
      await AJP.store.set('modelHealth', { gemini: { ranked: ['gemini-3.7-flash'], at: Date.now() } });
      await settings({ resolvedModels: { gemini: 'gemini-3.6-flash' } });
      fake(json({ error: { code: 400, message: 'Model gemini-3.6-flash is deprecated and no longer available.' } }, 400), ok);
      eq(await AJP.ai.tasks.test(), 'OK');
      eq(calls.map((c) => c.url.replace(/^.*\/models/, '')), ['/gemini-3.6-flash:generateContent', '?pageSize=200', '/gemini-3.7-flash:generateContent'], 'gone → list re-checked → next model');
    });
  }, { env: 'browser' });

  describe('providers › the tailoring AI is busy (your AJP-AI-5XX report)', () => {
    const busy = () => json({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }, 503);
    const REPLY = { ...REQ, edits: [] };
    beforeEach(async () => {
      await before();
      await settings({ provider: 'gemini', model: '', tailorProvider: 'gemini', tailorModel: '', resolvedModels: {}, keys: { ...KEYS, gemini: 'g', groq: 'gsk' } });
      await AJP.store.update('resumes', (r) => void Object.assign(r, { activeId: 'r', items: [{ id: 'r', name: 'R', text: '# Ana\n## Experience\n### Engineer, Acme\n- Built Python pipelines\n- Improved SQL reports' }] }));
    });
    afterEach(() => {
      after();
      AJP.panel.remove();
      Object.assign(AJP.contentHooks.state, { job: null, analysis: null, message: '', messageErr: false, busy: '' });
    });
    it('a busy provider never sends the resume to another provider by itself', async () => {
      fake(busy);
      const r = await AJP.send('resume.enhance', { jd: JD, job: { title: 'Data Engineer' }, score: 80 });
      eq(r.code, 'AJP-AI-5XX');
      ok(calls.every((c) => /generativelanguage/.test(c.url)), calls.map((c) => c.url).join(' '));
    });
    it('alternatives: your other keys, free first, Claude marked paid; never the busy one', async () => {
      const a = await AJP.send('ai.alternatives');
      eq([a.current, a.options.map((o) => o.id), a.options.find((o) => o.id === 'anthropic').paid], ['Google Gemini', ['groq', 'nvidia', 'mistral', 'anthropic'], true]);
    });
    it('"Try with Groq": this job goes to Groq, the saved tailoring AI stays Gemini', async () => {
      fake(() => openai(JSON.stringify(REPLY)));
      const r = await AJP.send('resume.enhance', { jd: JD, job: { title: 'Data Engineer' }, score: 80, via: 'groq' });
      ok(r.ok !== false && r.draft, JSON.stringify(r).slice(0, 200));
      ok(calls.length && calls.every((c) => /api\.groq\.com/.test(c.url)));
      eq([r.draft.via, r.draft.ai.provider], ['groq', 'groq']);
      eq((await AJP.store.get('settings')).ai.tailorProvider, 'gemini');
    });
    it('after the time budget it stops trying more models', async () => {
      AJP.ai.CONFIG.chainMs = -1;
      fake(busy);
      await AJP.send('resume.enhance', { jd: JD, job: { title: 'Data Engineer' }, score: 80 });
      eq(calls.length, 1);
    });
    it('the panel offers one button per other key; clicking it tailors with that AI', async () => {
      const st = AJP.contentHooks.state;
      Object.assign(st, { job: { title: 'Data Engineer', company: 'Acme' }, analysis: { score: 80, matched: [{ skill: 'Python', weight: 3, source: 'profile' }], missing: [], jdSkillCount: 1, ms: 1, fit: { workType: { job: ['remote'], wanted: ['remote'], ok: true }, salary: { job: { min: 150000, max: 190000, hourly: false }, ok: true }, location: { matched: null, ok: null } } } });
      fake(busy);
      AJP.contentHooks.render();
      const root = () => document.querySelector('ajp-panel').shadowRoot;
      root().querySelector('[data-act="tailor"]').click();
      await globalThis.AJPTest.waitFor(() => root().querySelector('[data-act="tailor"][data-arg="groq"]'), { msg: 'offer' });
      ok(/your resume and this job go to the one you pick/.test(root().textContent));
      fake(() => openai(JSON.stringify(REPLY)));
      root().querySelector('[data-act="tailor"][data-arg="groq"]').click();
      await globalThis.AJPTest.waitFor(() => /job requirements/.test(root().textContent), { msg: 'tailored' });
      ok(calls.every((c) => /api\.groq\.com/.test(c.url)));
    });
  }, { env: 'browser' });

  describe('providers › keys stay private', () => {
    beforeEach(before);
    afterEach(after);
    it('a backup leaves out every key, the new ones included (unless asked)', async () => {
      await settings({ keys: { ...KEYS, groq: 'gsk_x' } });
      const out = await AJP.store.exportAll();
      eq(Object.values(out.data.settings.ai.keys).filter(Boolean), []);
      eq(Object.keys(out.data.settings.ai.keys).sort(), ['anthropic', 'gemini', 'groq', 'mistral', 'nvidia', 'openrouter']);
      eq((await AJP.store.exportAll({ includeKeys: true })).data.settings.ai.keys.anthropic, 'sk-ant-test');
    });
    it('logs mask Anthropic and NVIDIA keys', () => {
      const s = AJP.scrub('key sk-ant-api03-AbCdEfGhIjKlMnOpQrSt and nvapi-AbCdEfGhIjKlMnOpQrSt');
      excludes(s, 'AbCdEfGhIjKlMnOpQrSt');
      includes(s, '[key]');
    });
    it('the manifest allows exactly the three new AI hosts', async () => {
      const m = await (await realFetch('../manifest.json', { cache: 'no-store' })).json();
      for (const h of ['https://api.anthropic.com/*', 'https://integrate.api.nvidia.com/*', 'https://api.mistral.ai/*']) ok(m.host_permissions.includes(h), h);
    });
  }, { env: 'browser' });
})();
