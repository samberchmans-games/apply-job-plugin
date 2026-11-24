/*
 * ai.js — pluggable AI providers (runs in the background context only, so API
 * keys never touch web pages). All providers below have a free tier or run locally.
 *
 *   gemini      Google AI Studio API key (free tier)        https://aistudio.google.com/apikey
 *   groq        Groq API key (free tier, very fast)          https://console.groq.com/keys
 *   openrouter  OpenRouter key, ":free" models               https://openrouter.ai/keys
 *   ollama      Local models, no key, nothing leaves the PC  https://ollama.com
 *   chrome      Chrome's built-in on-device model (Gemini Nano) through the Prompt API: no key, no account,
 *               nothing leaves the computer. Needs a recent desktop Chrome and a one-time model download
 *               (started from Admin, because the browser requires a click). Edge exposes the same API.
 *
 * Privacy: prompts only ever include resume text, skills and the job
 * description — never EEO answers (race, veteran, disability, gender).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.ai) return;

  const PROVIDERS = {
    none: { label: 'Off (offline keyword matching only)' },
    chrome: { label: 'Chrome built-in AI (on-device, no key, private)', defaultModel: 'on-device', local: true },
    gemini: { label: 'Google Gemini (free tier API key)', defaultModel: 'gemini-3.6-flash', needsKey: true }, // 2.5-flash is deprecated (404 for newer keys; shutdown 2026-12-01)
    groq: { label: 'Groq (free tier API key)', defaultModel: 'llama-3.3-70b-versatile', needsKey: true },
    openrouter: { label: 'OpenRouter (free models)', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', needsKey: true },
    ollama: { label: 'Ollama (local, private)', defaultModel: 'llama3.1' },
    nvidia: { label: 'NVIDIA NIM (free API key)', defaultModel: 'z-ai/glm-5.3-flash', needsKey: true },
    mistral: { label: 'Mistral (free plan API key)', defaultModel: 'mistral-medium-latest', needsKey: true },
    // Not free: billed per use from the user's prepaid Anthropic API credit (a Claude.ai / Claude Code plan doesn't cover it).
    anthropic: { label: 'Anthropic Claude (paid API key, pay per use)', defaultModel: 'claude-opus-5-5', needsKey: true, paid: true },
  };

  // patienceMs: for resume tailoring, a free-tier rate limit ("try again in 20s") is waited out once, up to this long.
  // testTimeoutMs: "Test connection" asks for one word; a model that can't say OK in 30 s is not usable anyway.
  // tries: one retry of a temporary failure on the same model, then the model manager moves on to the next model.
  const CONFIG = { timeoutMs: 90000, testTimeoutMs: 30000, listTimeoutMs: 15000, tailorTimeoutMs: 120000, firstByteMs: 28000, idleMs: 30000, chainMs: 75000, cutRetryMs: 30000, pacing: true, maxSwitches: 2, tries: 2, localMaxChars: 16000, patienceMs: 60000 }; // tests shorten these

  // Network goes through the shared standard (errors.js AJP.httpStream / AJP.http): timeouts, coded errors, retries for
  // temporary failures (server errors, network blips, short rate-limit waits).
  // "Free tier not available for this project / set up billing", "User location is not supported", or a quota of
  // "limit: 0" all mean the same to the user: this key can't be used for free. Say that, and point to Groq.
  const NO_FREE_TIER = /free tier is not available|set up billing|billing (account|is required|to upgrade)|enable billing|location is not supported|FAILED_PRECONDITION|limit:\s*0\b/i;
  // Anthropic: "Your credit balance is too low to access the Anthropic API" = the paid key has no credit left.
  const NO_CREDIT = /credit balance is too low/i;
  function request(url, opts = {}) {
    const { timeoutMs, ...rest } = opts;
    return AJP.http(url, rest, {
      timeoutMs: timeoutMs || CONFIG.timeoutMs,
      tries: CONFIG.tries,
      statusKey: AJP.aiErrorForStatus,
      networkKey: 'AI_NETWORK',
      timeoutKey: 'AI_TIMEOUT',
      badJsonKey: 'AI_BAD_RESPONSE',
      label: 'ai request',
      log: AJP.logger('ai'),
    });
  }

  /*
   * One cloud call, for every provider (ai-wire.js knows the differences). The answer is streamed; how it ended decides:
   *   cut off → once more with a larger output limit, then AJP-AI-CUT · refused → AJP-AI-REFUSED · error inside a 200 →
   *   the matching coded error · a setting this model rejects → dropped, remembered for the model, asked again.
   * Every provider error carries the provider's own words in its hint.
   */
  const W = () => AJP.aiWire;
  function providerError(e) {
    const x = AJP.toAppError(e);
    const d = x.details || {};
    const body = String(d.body || '');
    let out = x;
    // Gemini answers a bad key with HTTP 400 (seen on the live API).
    if (x.code === 'AJP-AI-HTTP' && /API_KEY_INVALID|API key not valid/i.test(body)) out = AJP.err('AI_AUTH', { status: d.status, host: d.host, body }, e);
    else if (/^AJP-AI-(HTTP|401|429)$/.test(x.code) && NO_CREDIT.test(body)) out = AJP.err('AI_CREDIT', { status: d.status, host: d.host, body }, e);
    else if (/^AJP-AI-(429|HTTP|401|404)$/.test(x.code) && NO_FREE_TIER.test(body)) out = AJP.err('AI_BILLING', { status: d.status, host: d.host, body }, e);
    else if (d.status === 402) out = AJP.err('AI_BILLING', { status: d.status, host: d.host, body }, e);
    else if (x.code !== 'AJP-AI-BIG' && W().isTooLarge(x)) out = AJP.err('AI_TOO_LARGE', { status: d.status, host: d.host, body }, e);
    const reason = W().reasonFrom(body);
    // OpenRouter counts every :free model (and failed calls) against one daily cap: waiting a minute won't help.
    if (out.code === 'AJP-AI-429' && /free-models-per-day/i.test(body)) out.hint = 'OpenRouter\'s free daily limit is used up. Use another AI provider now, or try again after it resets.';
    if (reason && !out.reason) {
      out.reason = AJP.scrub ? AJP.scrub(reason) : reason;
      out.hint = `The provider said: “${out.reason}”. ${out.hint || ''}`.trim();
    }
    return out;
  }
  // A failure reported inside a successful (HTTP 200) reply.
  function replyError(error, host) {
    const status = Number(error.code) || 0;
    const body = JSON.stringify({ error });
    const key = status ? AJP.aiErrorForStatus(status) : 'AI_HTTP';
    return providerError(AJP.err(key, { status: status || 200, body: body.slice(0, 600), host }));
  }
  const quirksOf = async (provider, model) => (((await AJP.store.get('modelHealth'))[provider] || {}).quirks || {})[model] || {};
  async function rememberQuirk(provider, model, quirk, value = true) {
    await AJP.store.update('modelHealth', (all) => {
      const h = (all[provider] = all[provider] || {});
      h.quirks = { ...(h.quirks || {}), [model]: { ...((h.quirks || {})[model] || {}), [quirk]: value } };
    });
    AJP.logger('ai').info(value === true ? 'Model does not take this setting; remembered' : 'Model limit learned; remembered', { provider, model, quirk, value });
  }
  // Groq: "Request too large … tokens per minute (TPM): Limit 6000" → that model's real per-minute budget.
  const minuteLimit = (x) => Number((/tokens per minute[\s\S]*?Limit[:\s]+(\d+)/i.exec(String((x.details && x.details.body) || '')) || [])[1]) || null;
  const MIN_OUTPUT = 1000;
  // Free-tier pace: a provider with a per-minute token budget is not sent more than it allows; tailoring waits instead.
  const spent = new Map();
  // need = this prompt + its output allowance; what is counted afterwards is what was really used.
  async function pace(provider, model, input, need, patient, tpm) {
    if (!tpm || !CONFIG.pacing) return null;
    const key = `${provider}:${model}`;
    const budget = tpm * 0.9;
    for (let i = 0; i < 3; i++) {
      const now = Date.now();
      const recent = (spent.get(key) || []).filter((x) => now - x.at < 60000);
      spent.set(key, recent);
      const used = recent.reduce((n, x) => n + x.n, 0);
      if (!patient || !recent.length || used + need <= budget) break;
      const wait = Math.min(CONFIG.patienceMs, recent[0].at + 60000 - now + 250);
      AJP.logger('ai').info('Pacing for the free per-minute limit', { provider, model, waitMs: wait });
      await new Promise((r) => setTimeout(r, wait));
    }
    const entry = { at: Date.now(), n: input };
    spent.set(key, [...(spent.get(key) || []), entry]);
    return entry;
  }
  async function callWire(provider, cfg, model, system, prompt, json) {
    const wire = W();
    const prof = wire.PROFILES[provider];
    const quirks = { ...(await quirksOf(provider, model)) };
    let enlarged = false;
    let paced = null;
    for (let round = 0; round < 5; round++) {
      // A free per-minute budget counts the prompt and the output allowance: ask for less output so one request fits.
      const tpm = quirks.tpm || prof.tpm;
      const input = Math.ceil((system.length + prompt.length) / 4);
      if (tpm) {
        const room = Math.floor(tpm * 0.95) - input;
        if (room < (quirks.maxOutput || prof.maxOutput)) quirks.maxOutput = Math.max(MIN_OUTPUT, room);
      }
      const req = wire.build({ provider, key: cfg.keys && cfg.keys[provider], model, system, prompt, json, baseUrl: cfg.ollamaUrl, quirks });
      const sink = wire.reader(provider);
      const total = cfg.timeoutMs;
      const started = Date.now();
      if (round === 0) paced = await pace(provider, model, input, input + (quirks.maxOutput || prof.maxOutput || 0), cfg.patient, tpm);
      let delivery;
      try {
        delivery = await AJP.httpStream(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) }, sink, {
          format: req.format,
          // Local models can take a while to load; cloud answers must start before Chrome's 30 s limit.
          firstByteMs: prof.local ? total : Math.min(total, CONFIG.firstByteMs),
          idleMs: prof.local ? total : Math.min(total, CONFIG.idleMs),
          totalMs: total,
          tries: CONFIG.tries,
          statusKey: AJP.aiErrorForStatus,
          networkKey: 'AI_NETWORK',
          timeoutKey: 'AI_TIMEOUT',
          badJsonKey: 'AI_BAD_RESPONSE',
          label: 'ai request',
          log: AJP.logger('ai'),
        });
      } catch (e) {
        const x = AJP.toAppError(e);
        const limit = wire.isTooLarge(x) ? minuteLimit(x) : null;
        if (limit && quirks.tpm !== limit) {
          quirks.tpm = limit;
          delete quirks.maxOutput;
          await rememberQuirk(provider, model, 'tpm', limit);
          continue;
        }
        const fix = wire.fixFor(x);
        if (fix && !quirks[fix]) {
          quirks[fix] = true;
          await rememberQuirk(provider, model, fix);
          continue;
        }
        throw providerError(x);
      }
      const r = sink.result();
      if (paced) paced.n = input + Math.ceil(r.text.length / 4);
      if (r.error) throw replyError(r.error, new URL(req.url).hostname);
      if (r.finish === 'refused') throw AJP.err('AI_REFUSED', { provider, category: r.category || null });
      if (r.finish === 'error') throw AJP.err('AI_SERVER', { provider, status: 200 });
      if (r.finish === 'length') {
        // Thinking models can spend the whole allowance before answering. A complete JSON answer is still fine.
        let usable = !json && !!r.text.trim();
        if (json && r.text.trim()) {
          try {
            parseJsonLoose(r.text);
            usable = true;
          } catch (_) {
            usable = false;
          }
        }
        if (usable) return r.text;
        const now = quirks.maxOutput || prof.maxOutput;
        const slowThinker = !r.text.trim() && Date.now() - started > CONFIG.cutRetryMs;
        if (!enlarged && !slowThinker && prof.maxOutputCap && now < prof.maxOutputCap) {
          enlarged = true;
          quirks.maxOutput = Math.min(now * 2, prof.maxOutputCap);
          AJP.logger('ai').info('Answer was cut off; asking again with more room', { provider, model, maxOutput: quirks.maxOutput, thinking: r.thinking });
          continue;
        }
        throw AJP.err('AI_CUT', { provider, model, thinking: r.thinking, chars: r.text.length });
      }
      // A stream that ended with no finish marker may be half an answer. Complete JSON is still fine; anything else isn't.
      if (delivery && delivery.streamed && !r.finish && r.text.trim()) {
        let whole = false;
        if (json) {
          try {
            parseJsonLoose(r.text);
            whole = true;
          } catch (_) {
            whole = false;
          }
        }
        if (!whole) throw AJP.err('AI_CUT', { provider, model, incomplete: true, chars: r.text.length });
      }
      return r.text;
    }
    throw AJP.err('AI_BAD_RESPONSE', { reason: 'no usable answer' });
  }
  const CALLERS = {};
  for (const k of ['gemini', 'groq', 'openrouter', 'nvidia', 'mistral', 'anthropic', 'ollama']) CALLERS[k] = (cfg, model, system, prompt, json) => callWire(k, cfg, model, system, prompt, json);

  // ---- Chrome built-in AI (Prompt API) ------------------------------------------------------------
  // Current API: global LanguageModel (Chrome 138+, Edge). Older builds: ai.languageModel with capabilities().
  const LOCAL_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  function localApi() {
    const g = globalThis;
    if (g.LanguageModel && typeof g.LanguageModel.create === 'function') return { kind: 'LanguageModel', api: g.LanguageModel };
    if (g.ai && g.ai.languageModel && typeof g.ai.languageModel.create === 'function') return { kind: 'ai.languageModel', api: g.ai.languageModel };
    return null;
  }
  async function localAvailability(lm) {
    if (lm.kind === 'LanguageModel') return String(await lm.api.availability(LOCAL_OPTS));
    const c = await lm.api.capabilities();
    return { readily: 'available', 'after-download': 'downloadable', no: 'unavailable' }[c && c.available] || 'unavailable';
  }
  function localCreate(lm, system, { signal, onProgress } = {}) {
    const monitor = onProgress ? (m) => m.addEventListener('downloadprogress', (e) => onProgress(e.total ? e.loaded / e.total : e.loaded)) : undefined;
    if (lm.kind === 'LanguageModel') return lm.api.create({ ...LOCAL_OPTS, ...(system ? { initialPrompts: [{ role: 'system', content: system }] } : {}), ...(monitor ? { monitor } : {}), signal });
    return lm.api.create({ ...(system ? { systemPrompt: system } : {}), ...(monitor ? { monitor } : {}), signal });
  }

  // The on-device model has a small input window: shrink the long blocks (resume, job post) proportionally,
  // keep the short ones (instructions, rules) whole.
  function fitPrompt(prompt, maxChars) {
    const text = String(prompt || '');
    if (text.length <= maxChars) return text;
    const blocks = text.split('\n\n');
    const LONG = 600;
    const longTotal = blocks.reduce((n, b) => n + (b.length > LONG ? b.length : 0), 0);
    const excess = text.length - maxChars + blocks.filter((b) => b.length > LONG).length * 16;
    if (!longTotal) return text.slice(0, maxChars);
    return blocks.map((b) => (b.length > LONG ? b.slice(0, Math.max(200, Math.floor(b.length - (excess * b.length) / longTotal))) + '\n…[shortened]' : b)).join('\n\n');
  }

  function localError(e, reason) {
    if (e && typeof e.code === 'string' && e.code.startsWith('AJP-')) return e;
    const name = (e && e.name) || '';
    if (name === 'AbortError' || name === 'TimeoutError') return AJP.err('AI_TIMEOUT', { provider: 'chrome' }, e);
    if (name === 'QuotaExceededError') return AJP.err('AI_LOCAL_TOO_LONG', { reason: reason || 'input too long' }, e);
    if (name === 'NotAllowedError') return AJP.err('AI_LOCAL_DOWNLOAD', { reason: 'the browser needs a click to start the model', name }, e);
    return AJP.err('AI_LOCAL_UNAVAILABLE', { name, reason: (e && e.message ? String(e.message) : String(e)).slice(0, 160) }, e);
  }

  async function promptOnce(session, text, json, signal) {
    if (!json) return session.prompt(text, { signal });
    try {
      return await session.prompt(text, { signal, responseConstraint: { type: 'object' } });
    } catch (e) {
      // Older builds don't know responseConstraint: ask again without it (the prompt already says "JSON only").
      if (e && (e.name === 'NotSupportedError' || e.name === 'TypeError' || e instanceof TypeError)) return session.prompt(text, { signal });
      throw e;
    }
  }

  async function callLocal(cfg, model, system, prompt, json) {
    const lm = localApi();
    if (!lm) throw AJP.err('AI_LOCAL_UNSUPPORTED');
    let state;
    try {
      state = await localAvailability(lm);
    } catch (e) {
      throw localError(e);
    }
    if (state === 'unavailable') throw AJP.err('AI_LOCAL_UNAVAILABLE', { reason: 'this computer or browser cannot run the on-device model' });
    if (state !== 'available') throw AJP.err('AI_LOCAL_DOWNLOAD', { state });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.timeoutMs);
    let session;
    try {
      session = await localCreate(lm, system, { signal: ctl.signal });
      let text = fitPrompt(prompt, CONFIG.localMaxChars);
      for (let attempt = 0; ; attempt++) {
        if (typeof session.measureInputUsage === 'function' && session.inputQuota) {
          const used = await session.measureInputUsage(text);
          const room = session.inputQuota - (session.inputUsage || 0);
          if (used > room) {
            if (attempt >= 3) throw AJP.err('AI_LOCAL_TOO_LONG', { used, room });
            text = fitPrompt(text, Math.floor(text.length * Math.max(0.3, (room / used) * 0.9)));
            continue;
          }
        }
        try {
          return await promptOnce(session, text, json, ctl.signal);
        } catch (e) {
          if (e && e.name === 'QuotaExceededError' && attempt < 3) {
            text = fitPrompt(text, Math.floor(text.length * 0.7));
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      throw localError(e);
    } finally {
      clearTimeout(timer);
      try {
        if (session && session.destroy) session.destroy();
      } catch (_) {
        /* the session is gone either way; destroying it is only to free memory */
      }
    }
  }
  CALLERS.chrome = callLocal;

  // Status for Admin / background: { state: available|downloadable|downloading|unavailable|unsupported, api }
  async function localStatus() {
    const lm = localApi();
    if (!lm) return { state: 'unsupported', api: null };
    try {
      return { state: await localAvailability(lm), api: lm.kind };
    } catch (e) {
      const x = localError(e);
      return { state: 'unavailable', api: lm.kind, code: x.code, error: x.message };
    }
  }
  // One-time model download: must run in a page, from a click (the browser requires a user gesture).
  async function localDownload(onProgress) {
    const lm = localApi();
    if (!lm) throw AJP.err('AI_LOCAL_UNSUPPORTED');
    let session;
    try {
      session = await localCreate(lm, '', { onProgress });
    } catch (e) {
      throw localError(e);
    } finally {
      try {
        if (session && session.destroy) session.destroy();
      } catch (_) {
        /* only freeing memory */
      }
    }
    return localStatus();
  }

  function parseJsonLoose(text) {
    const s = String(text || '').replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b < a) throw AJP.err('AI_BAD_RESPONSE', { reason: 'no JSON in answer', sample: s.slice(0, 120) });
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch (e) {
      throw AJP.err('AI_BAD_RESPONSE', { reason: 'invalid JSON in answer', sample: s.slice(a, a + 120) }, e);
    }
  }

  // ---- Model preferences per provider (best first), used by the model manager below.
  const PREFER = {
    groq: [/^llama-3\.3-70b/, /^openai\/gpt-oss-120b/, /^meta-llama\/llama-4-maverick/, /^qwen\/qwen3-32b/, /^moonshotai\/kimi-k2/, /^meta-llama\/llama-4-scout/, /^openai\/gpt-oss-20b/, /^llama-3\.1-8b/],
    // Numbered stable flash models first (newest first); the "-latest" alias can point at a preview that is overloaded.
    gemini: [/^gemini-[\d.]+-flash(-\d{3})?$/, /^gemini-flash-latest$/, /^gemini-2\.5-flash-lite$/, /^gemini-flash-lite-latest$/, /^gemini-[\d.]+-flash-lite(-\d{3})?$/,
      /^gemini-[\d.]+-flash-preview(-[\d-]+)?$/, /^gemini-pro-latest$/, /^gemini-[\d.]+-pro$/],
    // Capable free models first; small "flash/mini/nano" ones only as a last resort (they tailor poorly).
    openrouter: [/llama-3\.3-70b.*:free$/, /gpt-oss-120b:free$/, /deepseek-(chat|v3|r1)[^/]*:free$/, /qwen3-(235b|32b|30b|coder)[^/]*:free$/, /llama-4-maverick[^/]*:free$/,
      /gemma-3-27b[^/]*:free$/, /mistral-small[^/]*:free$/, /kimi-k2[^/]*:free$/, /gpt-oss-20b:free$/, /glm-4[^/]*:free$/, /^(?!.*(flash|mini|nano|lite|\b[1-8]b\b)).*:free$/i, /:free$/],
    // Fast general chat models first; very large ones (1T, 550B) last: they often can't answer in time on the free tier.
    nvidia: [/\/glm-[\d.]+-flash/, /\/minimax-m[\d.]+-flash/, /\/nemotron-[\d.]+-lightning/, /^google\/gemma-\d+-\d+b-it$/, /^openai\/gpt-oss-120b$/, /^qwen\/qwen3/, /^deepseek-ai\/deepseek/, /^meta\/llama-[34]/, /\/kimi-k/, /\/step-\d/, /^mistralai\/mistral-(medium|large)/],
    mistral: [/^mistral-medium-latest$/, /^mistral-small-latest$/, /^mistral-large-latest$/, /^mistral-(medium|small|large)/],
    anthropic: [/^claude-opus-5-5$/, /^claude-sonnet-5-5$/, /^claude-opus-\d/, /^claude-sonnet-\d/, /^claude-haiku-\d/],
  };
  const UPSTREAM_BUSY = /rate-limited upstream|temporarily rate.?limited|provider returned error/i;
  const NOT_CHAT = /whisper|tts|guard|embed|vision-preview|playai|distil|compound|image|audio|aqa|learnlm|gemma-3n|ocr|moderation|rerank|retriever|safety|parakeet|clip|pixtral|voxtral|gliner|starcoder|cosmos|ising|detector|translate/i;
  // Model lists are small: a short timeout, so a slow list never holds up the call that needs it.
  const listRequest = (url, opts = {}) => request(url, { ...opts, timeoutMs: CONFIG.listTimeoutMs });
  async function availableModels(cfg, provider) {
    if (provider === 'groq') {
      const d = await listRequest('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.groq}` } });
      return (d.data || []).filter((m) => m.active !== false).map((m) => m.id);
    }
    if (provider === 'gemini') {
      const d = await listRequest('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': cfg.keys.gemini } });
      return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
    }
    if (provider === 'openrouter') {
      const d = await listRequest('https://openrouter.ai/api/v1/models', {});
      return (d.data || []).map((m) => m.id).filter((id) => /:free$/.test(id)); // never switch a free user to a paid model
    }
    if (provider === 'nvidia') {
      const d = await listRequest('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.nvidia}` } });
      return (d.data || []).map((m) => m.id);
    }
    if (provider === 'mistral') {
      const d = await listRequest('https://api.mistral.ai/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.mistral}` } });
      return (d.data || []).filter((m) => !m.capabilities || m.capabilities.completion_chat !== false).map((m) => m.id);
    }
    if (provider === 'anthropic') {
      const d = await listRequest('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': cfg.keys.anthropic, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return (d.data || []).map((m) => m.id);
    }
    return [];
  }
  // Slow or special-purpose models (agents, deep research, robotics, live audio, video/music) can't answer a resume prompt
  // in time: never picked, even as a last resort (report R-20261121-XX1QF: a key without the default ended in AJP-AI-TIME).
  const SLOW = /deep-?research|robotics|computer-use|live|native-audio|veo|lyria|imagen|nano-banana|-exp\b|-exp-|experimental|deep-?think/i;
  const ver = (id) => parseFloat((String(id).match(/-(\d+(?:\.\d+)?)-/) || [0, 0])[1]) || 0;
  // The provider's current models, best first: preferences in order (Gemini: newest version first), slow / special /
  // non-chat models never. Up to 6.
  async function rankModels(cfg, provider) {
    let ids = (await availableModels(cfg, provider)).filter((id) => !NOT_CHAT.test(id) && !SLOW.test(id));
    if (provider === 'gemini') ids = ids.slice().sort((a, b) => ver(b) - ver(a));
    const out = [];
    for (const re of PREFER[provider] || []) for (const id of ids) if (re.test(id) && !out.includes(id)) out.push(id);
    if (!out.length) out.push(...(provider === 'gemini' ? ids.filter((id) => /^gemini-.*(flash|pro)/.test(id)) : ids));
    // Providers rename models often: keep a few more chat models behind the preferred ones, so one failure isn't the end.
    if (['nvidia', 'groq', 'mistral'].includes(provider)) for (const id of ids) if (out.length < 6 && !out.includes(id)) out.push(id);
    return out.slice(0, 6);
  }

  /*
   * ---- Model manager: providers retire, rename and throttle models all the time; nobody should have to fix the Model
   * field by hand. State lives in `modelHealth` (internal): per provider the ranked shortlist (refreshed daily and
   * whenever a model disappears) and models set aside for a while ("cooldown").
   *   order tried:  the model you typed (if any) → the last one that worked → others that worked for this key
   *                 (newest success first: known free and fast) → the shortlist → the built-in default; models cooling
   *                 down are skipped (unless nothing else is left). "Worked" lives in modelHealth (last, ok), never in
   *                 settings: Admin saves its own copy of the settings and would wipe it (the 3.8 → 3.7 → 3.6 every time bug).
   *   switch when:  gone (404, "deprecated / no longer available") · slow (timeout, once per call: each costs time) ·
   *                 busy (server error / overloaded after one retry, OpenRouter "busy upstream"); up to CONFIG.maxSwitches per call
   *                 · out of quota on one model (Gemini / Groq / NVIDIA count free limits per model)
   *                 · weak (cut off, empty or unreadable answer after its retry)
   *   cooldown:     a first failure rests briefly (busy 5 min, slow / weak 15 min), longer if it keeps failing (up to busy /
   *                 weak 1 h, slow 6 h) · gone 24 h · quota until it resets (Gemini daily: midnight Pacific)
   *   on success:   that model is remembered and its cooldown cleared
   */
  const RANK_VERSION = 2; // bumped when the preferences change: saved shortlists are rebuilt once
  const DAY = 24 * 3600 * 1000;
  const COOLDOWN = { gone: DAY, slow: 6 * 3600 * 1000, busy: 3600 * 1000, quota: 3600 * 1000, weak: 3600 * 1000 };
  // A first failure is often a passing moment: a short rest, longer only if the same model keeps failing.
  const FIRST_REST = { slow: 15 * 60000, busy: 5 * 60000, weak: 15 * 60000 };
  const STRIKES_FORGOTTEN_MS = DAY;
  // Gemini's daily quota resets at midnight Pacific time (ai.google.dev/gemini-api/docs/rate-limits).
  function nextPacificMidnight(now = Date.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now)).map((p) => [p.type, Number(p.value)]));
    return now + DAY - (parts.hour * 3600 + parts.minute * 60 + parts.second) * 1000 - (now % 1000);
  }
  // Out of quota: until the provider says (Retry-After / "retry in 40s"), a daily quota until tomorrow, else an hour.
  function quotaCooldown(x, provider) {
    const body = String((x.details && x.details.body) || '');
    if (/limit:\s*0\b/.test(body)) return DAY; // not in the free tier at all: don't try it again today
    if (/per ?day|daily|RequestsPerDay/i.test(body)) return provider === 'gemini' ? Math.max(60000, nextPacificMidnight() - Date.now()) : DAY;
    const w = waitAsked(x) || (/retry(?:Delay)?["\s:]*"?(\d+(?:\.\d+)?)s/i.exec(body) || [])[1] * 1000;
    return w > 0 ? Math.min(Math.max(w, 60000), DAY) : COOLDOWN.quota;
  }
  // Providers whose free limits count per model: one model out of quota says nothing about the others.
  // (OpenRouter's free limit is per account: switching models would not help.)
  const PER_MODEL_QUOTA = new Set(['gemini', 'groq', 'nvidia']);
  function switchReason(x, provider) {
    const body = String((x.details && x.details.body) || '');
    if (x.code === 'AJP-AI-429' && !UPSTREAM_BUSY.test(body) && PER_MODEL_QUOTA.has(provider)) return 'quota';
    // Gemini "limit: 0" for one model = that model isn't in the free tier (new models often aren't); others may be.
    if (x.code === 'AJP-AI-BILLING' && provider === 'gemini' && /limit:\s*0\b/.test(body)) return 'quota';
    if (x.code === 'AJP-AI-404' || (x.details && x.details.status === 410)) return 'gone'; // 410 = retired for good
    if (x.code === 'AJP-AI-HTTP' && /deprecat|no longer (available|supported)|decommission|not (found|supported|available) for|unknown model|invalid model|model .*(not exist|unavailable)/i.test(body)) return 'gone';
    if (x.code === 'AJP-AI-TIME') return 'slow';
    if (x.code === 'AJP-AI-429' && UPSTREAM_BUSY.test(body)) return 'busy';
    if (x.code === 'AJP-AI-5XX') return 'busy'; // "model is overloaded" / server error on this model: another model, not the same one again
    if (x.code === 'AJP-AI-CUT' || x.code === 'AJP-AI-FMT') return 'weak';
    if (x.code === 'AJP-AI-BIG') return 'big'; // too large for this model's limit: another model may take it (nothing wrong with this one) // this model couldn't give a complete, readable answer
    return null;
  }
  function candidates(provider, pinned, cfg, health) {
    const h = health[provider] || {};
    const bad = h.bad || {};
    const worked = Object.entries(h.ok || {}).sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const legacy = h.last || worked.length ? '' : (cfg.resolvedModels || {})[provider]; // from older versions (settings)
    const all = [...new Set([pinned, h.last, ...worked, legacy, ...(h.ranked || []), PROVIDERS[provider].defaultModel].filter(Boolean))];
    const ok = all.filter((m) => !(bad[m] > Date.now()));
    return ok.length ? ok : all;
  }
  async function refreshModels(cfg, provider) {
    const ranked = await rankModels(cfg, provider);
    // An empty or odd list (provider hiccup) never wipes a good shortlist.
    await AJP.store.update('modelHealth', (all) => void (all[provider] = { ...(all[provider] || {}), ...(ranked.length ? { ranked } : {}), at: Date.now(), rankV: RANK_VERSION }));
    return ranked;
  }
  async function setAside(provider, model, why, ms = COOLDOWN[why]) {
    if (why === 'gone') ms = COOLDOWN.gone;
    await AJP.store.update('modelHealth', (all) => {
      const h = (all[provider] = all[provider] || {});
      const now = Date.now();
      h.bad = Object.fromEntries(Object.entries(h.bad || {}).filter(([, until]) => until > now));
      if (FIRST_REST[why]) {
        const before = (h.strikes || {})[model];
        const n = before && now - before.at < STRIKES_FORGOTTEN_MS ? before.n + 1 : 1;
        h.strikes = { ...(h.strikes || {}), [model]: { n, at: now } };
        ms = Math.min(FIRST_REST[why] * 4 ** (n - 1), COOLDOWN[why]);
      }
      h.bad[model] = now + ms;
      h.why = { ...(h.why || {}), [model]: why };
      if (h.last === model) h.last = '';
      if (why === 'gone' && h.ok) delete h.ok[model];
      if (why === 'gone' && h.verified) delete h.verified[model];
    });
  }
  async function worked(provider, model) {
    await AJP.store.update('modelHealth', (all) => {
      const h = (all[provider] = all[provider] || {});
      h.last = model;
      h.ok = { ...(h.ok || {}), [model]: Date.now() };
      if (h.bad) delete h.bad[model];
      if (h.strikes) delete h.strikes[model];
    });
  }
  // Daily (background alarm) and from Admin "Re-check models now": refresh the shortlist of every provider in use.
  async function refreshAll({ reset = false } = {}) {
    const settings = await AJP.store.get('settings');
    const cfg = settings.ai;
    const used = [...new Set([cfg.provider, cfg.tailorProvider].filter((k) => k && PREFER[k] && (!PROVIDERS[k].needsKey || cfg.keys[k])))];
    if (reset) {
      await AJP.store.update('settings', (s) => void (s.ai.resolvedModels = {}));
      await AJP.store.update('modelHealth', (all) => void used.forEach((k) => all[k] && Object.assign(all[k], { bad: {}, ok: {}, last: '' })));
    }
    const out = {};
    for (const k of used) {
      try {
        out[k] = await refreshModels({ ...cfg, timeoutMs: CONFIG.listTimeoutMs }, k);
      } catch (e) {
        out[k] = { error: AJP.toAppError(e).code };
        AJP.logger('ai').warn('Model list could not be refreshed', { provider: k, code: out[k].error });
      }
    }
    return out;
  }

  // How long a rate-limited provider asked us to wait (Retry-After header, or "try again in 7.66s" in Groq's message).
  function waitAsked(x) {
    if (x.details && x.details.retryAfter) return x.details.retryAfter * 1000;
    const m = String((x.details && x.details.body) || '').match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i);
    if (!m) return null;
    return (m[1] ? +m[1] * 60000 : 0) + parseFloat(m[2]) * (m[3].toLowerCase() === 'ms' ? 1 : 1000);
  }

  // Every AI call is recorded (Admin → AI settings → Recent AI calls): which provider and model did the work, for what,
  // how long it took, whether it worked, and the models tried before it (path: [{model, why}]). Never the prompt or answer.
  const LABEL = (provider, model) => `${(PROVIDERS[provider] || {}).label ? PROVIDERS[provider].label.replace(/\s*\(.*$/, '') : provider} · ${model}`;
  async function recordCall(entry) {
    AJP.ai.last = entry;
    try {
      await AJP.store.update('aiCalls', (l) => [entry, ...(Array.isArray(l) ? l : [])].slice(0, 30));
    } catch (e) {
      AJP.logger('ai').warn('AI call not recorded', { error: e.message });
    }
  }

  /*
   * group 'tailor' uses settings.ai.tailorProvider when set (e.g. Chrome built-in AI for everyday tasks, Gemini or Groq
   * for resume tailoring). patient: wait out one free-tier rate limit of up to CONFIG.patienceMs, then retry.
   */
  async function complete({ system, prompt, json = false, task = 'complete', tid, group = '', patient = false, timeoutMs, via = '', exactModel = '' }) {
    const settings = await AJP.store.get('settings');
    const cfg = { ...settings.ai, timeoutMs: timeoutMs || CONFIG.timeoutMs };
    // via: a provider the user just picked for this job ("Try with Groq"). Never chosen automatically: resume text only
    // goes to a provider the user chose.
    const chosen = via && PROVIDERS[via] && via !== 'none' ? via : null;
    const own = chosen || (group === 'tailor' && cfg.tailorProvider && cfg.tailorProvider !== cfg.provider && PROVIDERS[cfg.tailorProvider] ? cfg.tailorProvider : null);
    const provider = own || cfg.provider;
    const p = PROVIDERS[provider];
    if (!p || provider === 'none') throw AJP.err('AI_OFF');
    if (p.needsKey && !cfg.keys[provider]) throw AJP.err('AI_NO_KEY', { provider });
    // The Model field belongs to the main provider, "Tailoring model" to the tailoring provider; the model manager
    // (above) picks the rest and moves on by itself when a model is gone, slow or busy.
    const pinned = chosen ? '' : own ? cfg.tailorModel : cfg.model;
    // Cloud tailoring gives up on one model sooner, so a busy provider doesn't hold the panel for minutes.
    if (patient && !timeoutMs && !p.local && provider !== 'ollama') cfg.timeoutMs = Math.min(cfg.timeoutMs, CONFIG.tailorTimeoutMs);
    const health = await AJP.store.get('modelHealth');
    cfg.patient = patient;
    let list = candidates(provider, pinned, cfg, health);
    // Tailoring stays on models that passed "Check my AI setup" (when it has been run): no jumping to untested ones.
    const verified = Object.entries((health[provider] || {}).verified || {}).sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const locked = !!exactModel || (group === 'tailor' && patient && !chosen && verified.length > 0);
    if (exactModel) list = [exactModel];
    else if (locked) {
      const bad = (health[provider] || {}).bad || {};
      const all = [...new Set([pinned, ...verified].filter(Boolean))];
      const good = all.filter((m) => !(bad[m] > Date.now()));
      list = good.length ? good : all;
    }
    let model = list[0];
    const tr = AJP.startTrace(`ai.${task}`, { mod: 'ai', tid, slowMs: 30000, data: { provider, model, promptChars: prompt.length } });
    const t0 = performance.now();
    const tried = new Set();
    const path = []; // every model tried in this call and why it was left: shown in Recent AI calls
    let switches = 0;
    let slowSwitched = false;
    let refreshed = false;
    const stale = !(health[provider] && health[provider].at > Date.now() - DAY);
    // One model, waiting out a short free-tier rate limit once when patient.
    const raw = async (text) => {
      try {
        return await CALLERS[provider](cfg, model, system, text, json);
      } catch (e) {
        const x = AJP.toAppError(e);
        // Another model of a per-model-quota provider is faster than waiting for this one.
        const another = PER_MODEL_QUOTA.has(provider) && list.some((m) => m !== model && !tried.has(m));
        const wait = x.code === 'AJP-AI-429' && patient && !another && !UPSTREAM_BUSY.test(String((x.details && x.details.body) || '')) ? waitAsked(x) : null;
        if (wait == null || wait > CONFIG.patienceMs) throw e;
        tr.log.info(`ai.${task} free-tier limit reached; waiting ${Math.ceil(wait / 1000)}s, then retrying once`, { provider, waitMs: Math.round(wait) });
        await new Promise((r) => setTimeout(r, wait + 250));
        return CALLERS[provider](cfg, model, system, text, json);
      }
    };
    // One model, one usable answer. Free models sometimes add prose or break JSON: asked once more with a firm reminder.
    const once = async (text) => {
      const need = (reply) => {
        if (!reply || !String(reply).trim()) throw AJP.err('AI_BAD_RESPONSE', { reason: 'empty answer' });
        return reply;
      };
      let out = need(await raw(text));
      if (!json) return { out, result: out.trim() };
      try {
        return { out, result: parseJsonLoose(out) };
      } catch (e) {
        tr.log.warn(`ai.${task} invalid JSON, retrying once`, { reason: e.details && e.details.reason });
        out = need(await raw(text + '\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONE valid JSON object only, no other text.'));
        return { out, result: parseJsonLoose(out) };
      }
    };
    const call = async (text) => {
      for (;;) {
        try {
          return await once(text);
        } catch (e) {
          const x = AJP.toAppError(e);
          const why = PREFER[provider] && !exactModel ? switchReason(x, provider) : null;
          if (!why || switches >= CONFIG.maxSwitches || (why === 'slow' && slowSwitched)) throw e;
          tried.add(model);
          if (why !== 'big') await setAside(provider, model, why, why === 'quota' ? quotaCooldown(x, provider) : undefined);
          if (why !== 'gone' && performance.now() - t0 > CONFIG.chainMs) {
            path.push({ model, why });
            throw e; // the provider is having a bad moment: tell the user now instead of trying more models
          }
          let next = list.find((m) => !tried.has(m));
          if (!locked && !refreshed && (why === 'gone' || stale || !next)) {
            refreshed = true;
            try {
              await refreshModels(cfg, provider);
              list = [...new Set([...candidates(provider, pinned, { ...cfg, resolvedModels: {} }, await AJP.store.get('modelHealth')), ...list])];
              next = list.find((m) => !tried.has(m));
            } catch (d) {
              tr.log.warn('Model list could not be read', { provider, code: AJP.toAppError(d).code });
            }
          }
          path.push({ model, why });
          if (!next) throw e;
          switches++;
          if (why === 'slow') slowSwitched = true;
          tr.log.info(`ai.${task} model "${model}" ${({ gone: 'not offered any more', slow: 'too slow', busy: 'busy', quota: 'out of free quota', weak: 'gave an incomplete answer', big: 'request too large for it' })[why]}; trying "${next}"`, { provider, from: model, to: next, why });
          model = next;
        }
      }
    };
    try {
      const { out, result } = await call(prompt);
      tr.end({ provider, model, outChars: out.length });
      if (PREFER[provider] && !exactModel) await worked(provider, model);
      await recordCall({ at: new Date().toISOString(), task, provider, model, label: LABEL(provider, model), ms: Math.round(performance.now() - t0), ok: true, ...(path.length ? { path } : {}) });
      return result;
    } catch (e) {
      const x = tr.fail(e, { provider, model });
      await recordCall({ at: new Date().toISOString(), task, provider, model, label: LABEL(provider, model), ms: Math.round(performance.now() - t0), ok: false, code: x.code, ...(path.length ? { path } : {}) });
      throw x;
    }
  }

  // The user's other cloud AI keys, offered as a one-click choice when the tailoring AI is busy. Free ones first.
  async function alternatives(exclude = '') {
    const cfg = (await AJP.store.get('settings')).ai;
    const current = exclude || cfg.tailorProvider || cfg.provider;
    const name = (k) => (PROVIDERS[k] ? PROVIDERS[k].label.replace(/\s*\(.*$/, '') : k);
    const checks = await AJP.store.get('aiChecks');
    const ready = (k) => !!(checks[k] && checks[k].status === 'ready');
    const options = ['groq', 'nvidia', 'mistral', 'gemini', 'openrouter', 'anthropic']
      .filter((k) => k !== current && cfg.keys && cfg.keys[k] && !(checks[k] && checks[k].status === 'failed' && !checks[k].temporary))
      .map((k) => ({ id: k, label: name(k), paid: !!PROVIDERS[k].paid, ready: ready(k) }))
      .sort((a, b) => Number(b.ready) - Number(a.ready));
    return { current: name(current), options };
  }

  const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '\n…[truncated]' : String(s || ''));

  function skillList(profile) {
    return (profile.skills || []).map((s) => (s.years ? `${s.name} (${s.years}y${s.level ? ', ' + s.level : ''})` : s.name)).join(', ');
  }

  // ---- Tasks ---------------------------------------------------------------
  const tasks = {
    extractSkills({ jd, tid }) {
      return complete({
        task: 'extractSkills',
        tid,
        json: true,
        system: 'You analyze job descriptions for a job seeker. Reply with strict JSON only.',
        prompt:
          'From the job description below, return JSON with this exact shape:\n' +
          '{"title":"","company":"","required_skills":[],"preferred_skills":[],"years_required":null,"seniority":"","summary":""}\n' +
          'Rules: skills are short canonical names (e.g. "Kubernetes", "Stakeholder management"), max 25 each, ' +
          'no duplicates, no generic filler like "team player". summary = 2 sentences.\n\nJOB DESCRIPTION:\n' +
          clip(jd, 14000),
      });
    },

    // Resume enhancement v2, stage 1: requirements + evidence (prompt lives in resume-engine.js).
    // A job that lists several skills has several requirements: a reply with fewer than 3 is asked again, once.
    async analyzeForResume({ jd, resumeText, tid, via }) {
      const p = AJP.resumeEngine.analyzePrompt({ jd, resumeText });
      const first = await complete({ task: 'resume.analyze', tid, via, json: true, group: 'tailor', patient: true, ...p });
      const n = Array.isArray(first && first.requirements) ? first.requirements.length : 0;
      const listed = AJP.matcher ? AJP.matcher.findSkills(jd).size : 0;
      if (n >= 3 || listed < 5) return first;
      AJP.logger('ai').info('Too few requirements from the AI; asking again once', { got: n, jobSkills: listed });
      const again = await complete({
        task: 'resume.analyze.retry', tid, via, json: true, group: 'tailor', patient: true, system: p.system,
        prompt: p.prompt + `\n\nIMPORTANT: Your previous answer listed only ${n} requirement${n === 1 ? '' : 's'}, but this job names at least ${listed} distinct skills or tools. ` +
          'List 6 to 15 SEPARATE requirements, one per skill, tool, responsibility or qualification. Split combined ones ("AWS, Glue and Snowflake" = three requirements).',
      });
      const m = Array.isArray(again && again.requirements) ? again.requirements.length : 0;
      return m > n ? again : first;
    },

    // Stage 3: targeted, evidence-backed edits (at most maxEdits: a light touch, not a rewrite).
    proposeResumeEdits({ doc, requirements, atsKeywords, skills, job, maxEdits, tid, via }) {
      return complete({ task: 'resume.edits', tid, via, json: true, group: 'tailor', patient: true, ...AJP.resumeEngine.editsPrompt({ doc, requirements, atsKeywords, skills, job, maxEdits }) });
    },

    // Skills the user CONFIRMED, each written into one line of the job they chose.
    weaveSkills({ picks, job, tid, via }) {
      return complete({ task: 'resume.weaveSkills', tid, via, json: true, group: 'tailor', patient: true, ...AJP.resumeEngine.weavePrompt({ picks, job }) });
    },

    draftAnswer({ question, jd, resumeText, profile, job, maxWords, tid }) {
      const p = profile.personal || {};
      return complete({
        task: 'draftAnswer',
        tid,
        system:
          'You help a job seeker answer application questions in first person. Be specific, warm and concise. ' +
          'Use ONLY facts from the resume and profile. If a needed fact is missing, insert a short [bracketed placeholder] ' +
          'for the candidate to fill. Never invent facts. Output only the answer text.',
        prompt:
          `Application question: "${question}"\n` +
          `Length: ${maxWords ? 'at most ' + maxWords + ' words' : '80-180 words unless the question clearly wants a short answer'}.\n\n` +
          `Role: ${(job && job.title) || ''} ${job && job.company ? 'at ' + job.company : ''}\n` +
          `Candidate: ${[p.firstName, p.lastName].filter(Boolean).join(' ')}, ${p.currentTitle || ''} ${p.yearsExperience ? '(' + p.yearsExperience + ' yrs)' : ''}\n` +
          `Skills: ${skillList(profile)}\n\nRESUME:\n${clip(resumeText, 12000)}\n\nJOB DESCRIPTION:\n${clip(jd, 6000)}`,
      });
    },

    test({ tid, group = '' } = {}) {
      return complete({ task: 'test', tid, group, system: 'Reply with one word.', prompt: 'Say OK.', timeoutMs: CONFIG.testTimeoutMs });
    },
  };

  AJP.ai = { PROVIDERS, CONFIG, complete, tasks, parseJsonLoose, label: LABEL, last: null, models: { refreshAll, rank: rankModels, RANK_VERSION, nextPacificMidnight }, alternatives, local: { api: localApi, status: localStatus, download: localDownload, fitPrompt } };
})();
