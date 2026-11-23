/*
 * The rebuilt AI path: per-provider requests, streamed replies in each provider's documented format, how an answer
 * ended (cut off, refused, error inside a 200), settings a model rejects, free-tier pace, and "Check my AI setup".
 * The network is simulated here; the real proof is the Check button with real keys.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, rejects, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const W = AJP.aiWire;
  const feed = (provider, events) => {
    const r = W.reader(provider);
    events.forEach(r.event);
    return r.result();
  };

  describe('ai wire › requests per provider', () => {
    const b = (provider, o = {}) => W.build({ provider, key: 'k', model: 'm', system: 'S', prompt: 'P', json: true, ...o });
    it('every cloud provider streams and sets an output limit', () => {
      for (const p of ['groq', 'openrouter', 'nvidia', 'mistral', 'anthropic']) eq([b(p).body.stream, b(p).body.max_tokens > 0], [true, true], p);
      includes(b('gemini').url, ':streamGenerateContent?alt=sse');
      ok(b('gemini').body.generationConfig.maxOutputTokens > 0);
      eq([b('ollama').format, b('ollama').body.stream], ['ndjson', true]);
    });
    it('JSON the way each provider takes it', () => {
      eq(b('groq').body.response_format, { type: 'json_object' });
      notOk('response_format' in b('nvidia').body);
      includes(b('nvidia').body.messages[0].content, 'ONE valid JSON object');
      eq(b('gemini').body.generationConfig.responseMimeType, 'application/json');
      includes(b('anthropic').body.system, 'ONE valid JSON object');
      notOk('temperature' in b('anthropic').body);
    });
    it('learned quirks drop the setting', () => {
      const r = b('groq', { quirks: { noJsonMode: true, noTemperature: true } }).body;
      eq(['response_format' in r, 'temperature' in r], [false, false]);
      includes(r.messages[0].content, 'ONE valid JSON object');
      notOk('thinkingConfig' in b('gemini', { model: 'gemini-3.6-flash', quirks: { noThinking: true } }).body.generationConfig);
    });
  });

  describe('ai wire › reading replies', () => {
    it('OpenAI style: pieces joined; reasoning is not the answer; length, filter, error', () => {
      eq(feed('groq', [{ choices: [{ delta: { reasoning: 'hmm' } }] }, { choices: [{ delta: { content: 'He' } }] }, { choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }] }]).text, 'Hello');
      eq(feed('groq', [{ choices: [{ delta: { reasoning_content: 'long' }, finish_reason: 'length' }] }]).finish, 'length');
      eq(feed('openrouter', [{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }]).finish, 'refused');
      const e = feed('openrouter', [{ choices: [{ delta: { content: 'par' }, finish_reason: 'error', error: { code: 502, message: 'down' } }] }]);
      eq([e.finish, e.error.code], ['error', 502]);
    });
    it('Gemini: thought parts skipped; MAX_TOKENS, SAFETY, a blocked prompt', () => {
      eq(feed('gemini', [{ candidates: [{ content: { parts: [{ text: 'secret', thought: true }, { text: 'OK' }] }, finishReason: 'STOP' }] }]).text, 'OK');
      eq(feed('gemini', [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }]).finish, 'length');
      eq(feed('gemini', [{ candidates: [{ finishReason: 'SAFETY' }] }]).finish, 'refused');
      eq(feed('gemini', [{ promptFeedback: { blockReason: 'OTHER' } }]).category, 'OTHER');
    });
    it('Anthropic events and a plain message', () => {
      const s = feed('anthropic', [{ type: 'message_start', message: {} }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]);
      eq([s.text, s.finish], ['Hi', 'stop']);
      eq(feed('anthropic', [{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]).finish, 'length');
      eq(feed('anthropic', [{ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'OK' }], stop_reason: 'end_turn' }]).text, 'OK');
    });
    it('reasonFrom: the provider’s own words, even from a cut-off body', () => {
      eq(W.reasonFrom('{"error":{"message":"Bad thing"}}'), 'Bad thing');
      eq(W.reasonFrom('{"type":"about:blank","title":"Gone","status":410,"detail":"The model is gone"}'), 'The model is gone');
      eq(W.reasonFrom('{"error":{"message":"Provider returned error","metadata":{"raw":"model is rate-limited"}}}'), 'model is rate-limited');
      eq(W.reasonFrom('{"error":{"message":"Cut off here'), 'Cut off here');
    });
    it('fixFor names the rejected setting; too-large is recognized', () => {
      const x = (status, body) => ({ details: { status, body } });
      eq([W.fixFor(x(400, "'response_format' not supported")), W.fixFor(x(400, 'temperature must be 1')), W.fixFor(x(400, 'Thinking level is not supported')), W.fixFor(x(401, 'temperature'))], ['noJsonMode', 'noTemperature', 'noThinking', null]);
      ok(W.isTooLarge(x(413, 'x')) && W.isTooLarge(x(400, 'maximum context length is 8192')));
      notOk(W.isTooLarge(x(400, 'bad param')));
    });
  });

  // ---- Real streams through the full call (browser) -------------------------------------------------
  const mock = globalThis.browser;
  const enc = new TextEncoder();
  const sse = (events, type = 'text/event-stream') => new Response(new ReadableStream({ start(c) {
    // Split across chunk boundaries, as networks do.
    const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
    for (let i = 0; i < text.length; i += 17) c.enqueue(enc.encode(text.slice(i, i + 17)));
    c.close();
  } }), { headers: { 'content-type': type } });
  const oai = (t, finish = 'stop') => sse([{ choices: [{ delta: { content: t } }] }, { choices: [{ delta: {}, finish_reason: finish }] }, '[DONE]']);
  const http = (status, body) => new Response(JSON.stringify(body), { status });
  let calls;
  let real;
  const saved = {};
  const net = (fn) => {
    calls = [];
    globalThis.fetch = async (url, o) => {
      const c = { url: String(url), body: o && o.body ? JSON.parse(o.body) : null };
      calls.push(c);
      return fn(c, calls.length);
    };
  };
  async function before(ai = {}) {
    await mock.__reset();
    if (!real) { // some tests call this again to switch provider: keep the true originals
      real = globalThis.fetch;
      Object.assign(saved, AJP.ai.CONFIG);
    }
    AJP.ai.CONFIG.tries = 1;
    await AJP.store.update('settings', (s) => void Object.assign(s.ai, { provider: 'groq', model: 'm1', tailorProvider: '', tailorModel: '', keys: { gemini: 'g', groq: 'gsk', openrouter: 'or', nvidia: 'nv', mistral: 'mi', anthropic: 'ant' }, ...ai }));
  }
  function after() {
    globalThis.fetch = real;
    real = null;
    Object.assign(AJP.ai.CONFIG, saved);
  }
  const ask = (o = {}) => AJP.ai.complete({ system: 'S', prompt: 'P', ...o });

  describe('ai wire › a full call', () => {
    beforeEach(() => before());
    afterEach(after);
    it('a real SSE stream, split at odd places, becomes the answer', async () => {
      net(() => oai('Hello world'));
      eq(await ask(), 'Hello world');
    });
    it('each provider’s stream format', async () => {
      await before({ provider: 'gemini', model: 'gemini-3.6-flash' });
      net(() => sse([{ candidates: [{ content: { parts: [{ text: 'Gem' }] } }] }, { candidates: [{ content: { parts: [{ text: 'ini' }] }, finishReason: 'STOP' }] }]));
      eq(await ask(), 'Gemini');
      await before({ provider: 'anthropic', model: 'claude-haiku-5-5' });
      net(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Claude' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]));
      eq(await ask(), 'Claude');
      await before({ provider: 'ollama', model: 'llama3.1' });
      net(() => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('{"message":{"content":"Lo"}}\n{"message":{"content":"cal"},"done":true}\n')); c.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } }));
      eq(await ask(), 'Local');
    });
    it('cut off: asked again once with more room; then a clear AJP-AI-CUT', async () => {
      net((c, n) => (n === 1 ? oai('{"a":', 'length') : oai('{"a":1}')));
      eq(await ask({ json: true }), { a: 1 });
      ok(calls[1].body.max_tokens > calls[0].body.max_tokens);
      const model = calls[0].body.model;
      net(() => oai('{"a":', 'length'));
      eq((await rejects(() => ask({ json: true, exactModel: model }))).code, 'AJP-AI-CUT');
      eq(calls.length, 2, 'on one exact model; otherwise the next model is tried');
    });
    it('a thinking model that used its whole allowance is not an "empty answer"', async () => {
      net(() => sse([{ choices: [{ delta: { reasoning: 'thinking…' }, finish_reason: 'length' }] }]));
      eq((await rejects(() => ask())).code, 'AJP-AI-CUT');
    });
    it('an error inside HTTP 200 is an error, not an empty or partial answer', async () => {
      await before({ provider: 'openrouter', model: 'x:free' });
      net(() => sse([{ choices: [{ delta: { content: 'part' }, finish_reason: 'error', error: { code: 502, message: 'Model is down' } }] }]));
      const e = await rejects(() => ask({ exactModel: 'x:free' }));
      eq(e.code, 'AJP-AI-5XX');
      includes(e.hint, 'Model is down');
    });
    it('a refusal is AJP-AI-REFUSED', async () => {
      net(() => oai('', 'content_filter'));
      eq((await rejects(() => ask())).code, 'AJP-AI-REFUSED');
    });
    it('a setting the model rejects is dropped, asked again and remembered for that model', async () => {
      net((c, n) => (n === 1 ? http(400, { error: { message: "'response_format' is not supported with this model" } }) : oai('{"ok":1}')));
      eq(await ask({ json: true }), { ok: 1 });
      notOk('response_format' in calls[1].body);
      eq((await AJP.store.get('modelHealth')).groq.quirks.m1.noJsonMode, true);
      net(() => oai('{"ok":2}'));
      await ask({ json: true });
      notOk('response_format' in calls[0].body, 'no failed call next time');
    });
    it('the provider’s real reason is in the error; 413 is "too large"; 402 is billing', async () => {
      net(() => http(400, { error: { message: 'Something specific is wrong' } }));
      const e = await rejects(() => ask({ exactModel: 'm1' }));
      eq(e.code, 'AJP-AI-HTTP');
      includes(e.hint, 'Something specific is wrong');
      net(() => http(413, { error: { message: 'Request too large for model on tokens per minute' } }));
      eq((await rejects(() => ask({ exactModel: 'm1' }))).code, 'AJP-AI-BIG');
      net(() => http(402, { error: { message: 'Insufficient credits' } }));
      eq((await rejects(() => ask({ exactModel: 'm1' }))).code, 'AJP-AI-BILLING');
    });
    it('Gemini’s real bad-key answer (HTTP 400, captured from the live API) is a key error', async () => {
      await before({ provider: 'gemini', model: 'gemini-3.6-flash' });
      net(() => http(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }));
      const e = await rejects(() => ask({ exactModel: 'gemini-3.6-flash' }));
      eq(e.code, 'AJP-AI-401');
      includes(e.hint, 'API key not valid');
    });
    it('no answer before the first-byte limit → AJP-AI-TIME, well before Chrome’s 30 s', async () => {
      AJP.ai.CONFIG.firstByteMs = 40;
      globalThis.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))));
      const t0 = performance.now();
      eq((await rejects(() => ask({ exactModel: 'm1' }))).code, 'AJP-AI-TIME');
      ok(performance.now() - t0 < 1500);
    });
    it('free-tier pace: a second tailoring call waits when the minute’s budget would be exceeded', async () => {
      AJP.ai.CONFIG.pacing = true;
      AJP.ai.CONFIG.patienceMs = 50;
      net(() => oai('x'.repeat(16000)));
      const big = 'p'.repeat(20000);
      await ask({ prompt: big, patient: true, exactModel: 'pace-model' });
      const t0 = performance.now();
      await ask({ prompt: big, patient: true, exactModel: 'pace-model' });
      ok(performance.now() - t0 >= 45, 'waited');
    });
    it('tailoring stays on verified models and never jumps to an untested one', async () => {
      await before({ model: '' });
      await AJP.store.set('modelHealth', { groq: { verified: { good: Date.now() }, ranked: ['untested'], at: Date.now() } });
      net(() => http(503, { error: { message: 'overloaded' } }));
      eq((await rejects(() => ask({ group: 'tailor', patient: true, task: 'resume.edits' }))).code, 'AJP-AI-5XX');
      eq(calls.map((c) => c.body && c.body.model), ['good']);
    });
  }, { env: 'browser' });

  describe('ai wire › Check my AI setup', () => {
    beforeEach(() => before({ provider: 'groq', model: '' }));
    afterEach(after);
    const models = () => http(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }] });
    const REQ = JSON.stringify({ requirements: [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'R' + i, text: 'r', priority: 'must', match: 'strong', evidence: ['Built a Python and Airflow pipeline platform'] })), ats_keywords: [] });
    const answer = (c) => {
      if (/\/models/.test(c.url)) return models();
      if (/strict JSON only/.test(c.body.messages[0].content) && /exactly this JSON/.test(c.body.messages[1].content)) return oai('{"ok":true,"items":["a","b","c"]}');
      if (c.body.response_format) return oai(REQ);
      return oai('OK');
    };
    it('passes a model through all three steps with the SAMPLE resume; records it as verified', async () => {
      await AJP.store.update('resumes', (r) => void Object.assign(r, { activeId: 'r', items: [{ id: 'r', name: 'Mine', text: 'MY-REAL-RESUME-TEXT' }] }));
      net(answer);
      const r = (await AJP.send('ai.check', { provider: 'groq' })).result;
      eq([r.status, r.verified], ['ready', ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']]);
      eq(r.models[0].steps.map((s) => s.name), ['short', 'json', 'full']);
      notOk(calls.some((c) => JSON.stringify(c.body || '').includes('MY-REAL-RESUME-TEXT')), 'never the user’s resume');
      ok(calls.some((c) => JSON.stringify(c.body || '').includes('Alex Example')));
      ok((await AJP.store.get('modelHealth')).groq.verified['llama-3.3-70b-versatile']);
    });
    it('one model failing moves to the next; the exact reason is kept', async () => {
      net((c) => (c.body && c.body.model === 'llama-3.3-70b-versatile' ? http(400, { error: { message: 'This model is decommissioned' } }) : answer(c)));
      const r = (await AJP.send('ai.check', { provider: 'groq' })).result;
      eq([r.status, r.verified], ['ready', ['openai/gpt-oss-120b']]);
      eq(r.models[0].steps[0].reason, 'This model is decommissioned');
    });
    it('quality gate (real result: a tiny model passed on valid JSON alone): too few requirements or invented quotes fail', async () => {
      const weak = JSON.stringify({ requirements: [1, 2, 3].map((i) => ({ id: 'R' + i, text: 'r', priority: 'must', match: 'strong', evidence: ['Built a Python and Airflow pipeline platform'] })), ats_keywords: [] });
      const fake = JSON.stringify({ requirements: [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'R' + i, text: 'r', priority: 'must', match: 'strong', evidence: ['Invented a quantum database at NASA'] })), ats_keywords: [] });
      net((c) => (c.body && c.body.response_format && !/exactly this JSON/.test(JSON.stringify(c.body)) ? oai(c.body.model === 'llama-3.3-70b-versatile' ? weak : fake) : answer(c)));
      const r = (await AJP.send('ai.check', { provider: 'groq' })).result;
      eq([r.status, r.verified], ['failed', []]);
      includes(r.models[0].steps[2].reason, 'only 3');
      includes(r.models[1].steps[2].reason, 'real quotes');
    });
    it('very small models are tried last', async () => {
      net((c) => (/\/models/.test(c.url) ? http(200, { data: [{ id: 'allam-2-7b' }, { id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] }) : answer(c)));
      const r = (await AJP.send('ai.check', { provider: 'groq' })).result;
      notOk(r.verified.includes('allam-2-7b'), r.verified.join());
    });
    it('a slow thinking model that used its allowance is not asked again for minutes more', async () => {
      AJP.ai.CONFIG.cutRetryMs = -1;
      net(() => sse([{ choices: [{ delta: { reasoning: 'thinking…' }, finish_reason: 'length' }] }]));
      eq((await rejects(() => ask({ exactModel: 'm1' }))).code, 'AJP-AI-CUT');
      eq(calls.length, 1);
    });
    it('Groq’s real "Failed to generate JSON" → asked again with JSON in the prompt', async () => {
      net((c, n) => (n === 1 ? http(400, { error: { message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.", code: 'json_validate_failed' } }) : oai('{"ok":1}')));
      eq(await ask({ json: true, exactModel: 'gpt-x' }), { ok: 1 });
      notOk('response_format' in calls[1].body);
    });
    it('the NVIDIA account id in its real 404 is masked', () => {
      const t = AJP.scrub("Function 'ee47df99': Not found for account 'n3_W4dg1_irKRr9NyLHoxs3MLg'");
      notOk(t.includes('n3_W4dg1'), t);
      includes(t, 'Not found for account');
    });
    it('a wrong key stops at once with AJP-AI-401; nothing is verified', async () => {
      net(() => http(401, { error: { message: 'Invalid API Key' } }));
      const r = (await AJP.send('ai.check', { provider: 'groq' })).result;
      eq([r.status, r.code, r.verified], ['failed', 'AJP-AI-401', []]);
      ok(calls.length <= 2);
    });
    it('a provider that failed the check is not offered as an alternative; ready ones come first', async () => {
      await AJP.store.set('aiChecks', { nvidia: { status: 'failed' }, mistral: { status: 'ready' } });
      await AJP.store.update('settings', (s) => void Object.assign(s.ai, { provider: 'gemini' }));
      const a = await AJP.send('ai.alternatives');
      eq(a.options[0].id, 'mistral');
      notOk(a.options.some((o) => o.id === 'nvidia'));
    });
    it('the report has models and reasons, and masks keys', async () => {
      const t = AJP.aiCheck.report([{ label: 'Groq', status: 'failed', code: 'AJP-AI-401', reason: 'bad key gsk_abcdefghijklmnopqrstuvwx', verified: [], models: [{ model: 'm', steps: [{ name: 'short', ok: false, code: 'AJP-AI-401', ms: 100, reason: 'x' }] }] }]);
      includes(t, 'Groq: FAILED AJP-AI-401');
      notOk(t.includes('abcdefghijklmnop'));
    });
  }, { env: 'browser' });
})();
