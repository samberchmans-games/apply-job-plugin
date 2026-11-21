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
    nvidia: { label: 'NVIDIA NIM (free API key)', defaultModel: 'meta/llama-3.3-70b-instruct', needsKey: true },
    mistral: { label: 'Mistral (free plan API key)', defaultModel: 'mistral-medium-latest', needsKey: true },
    // Not free: billed per use from the user's prepaid Anthropic API credit (a Claude.ai / Claude Code plan doesn't cover it).
    anthropic: { label: 'Anthropic Claude (paid API key, pay per use)', defaultModel: 'claude-opus-5-5', needsKey: true, paid: true },
  };

  // patienceMs: for resume tailoring, a free-tier rate limit ("try again in 20s") is waited out once, up to this long.
  // testTimeoutMs: "Test connection" asks for one word; a model that can't say OK in 30 s is not usable anyway.
  // tries: one retry of a temporary failure on the same model, then the model manager moves on to the next model.
  const CONFIG = { timeoutMs: 90000, testTimeoutMs: 30000, listTimeoutMs: 15000, tailorTimeoutMs: 60000, chainMs: 75000, maxSwitches: 2, tries: 2, localMaxChars: 16000, patienceMs: 60000 }; // tests shorten these

  // Network goes through the shared standard (errors.js AJP.http): timeout, coded errors, retries for
  // temporary failures (server errors, network blips, short rate-limit waits). Timeouts are not retried
  // (each already waited CONFIG.timeoutMs).
  // "Free tier not available for this project / set up billing", "User location is not supported", or a quota of
  // "limit: 0" all mean the same to the user: this key can't be used for free. Say that, and point to Groq.
  const NO_FREE_TIER = /free tier is not available|set up billing|billing (account|is required|to upgrade)|enable billing|location is not supported|FAILED_PRECONDITION|limit:\s*0\b/i;
  // Anthropic: "Your credit balance is too low to access the Anthropic API" = the paid key has no credit left.
  const NO_CREDIT = /credit balance is too low/i;
  async function fetchJson(url, opts) {
    try {
      return await request(url, opts);
    } catch (e) {
      const x = AJP.toAppError(e);
      if (/^AJP-AI-(HTTP|401|429)$/.test(x.code) && NO_CREDIT.test(String((x.details && x.details.body) || ''))) {
        throw AJP.err('AI_CREDIT', { status: x.details.status, host: x.details.host }, e);
      }
      if (/^AJP-AI-(429|HTTP|401|404)$/.test(x.code) && NO_FREE_TIER.test(String((x.details && x.details.body) || ''))) {
        throw AJP.err('AI_BILLING', { status: x.details.status, host: x.details.host, body: x.details.body }, e);
      }
      throw e;
    }
  }
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

  // jsonMode false: the provider/model may reject response_format, so JSON is asked for in the prompt only
  // (parseJsonLoose + the one JSON retry in complete() handle the rest).
  async function callOpenAICompatible(url, key, model, system, prompt, json, { headers: extraHeaders = {}, jsonMode = true, timeoutMs } = {}) {
    const body = {
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    };
    if (json && jsonMode) body.response_format = { type: 'json_object' };
    if (json && !jsonMode) body.messages[0].content += '\n\nReply with ONE valid JSON object only, no other text.';
    const data = await fetchJson(url, {
      timeoutMs,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(body),
    });
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  }

  function geminiThinking(model) {
    const m = String(model);
    if (/^gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 }; // 2.5 Flash / Flash-Lite: thinking off
    if (/^gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 }; // 2.5 Pro: the minimum
    if (/^gemini-(flash|pro)/.test(m) || /^gemini-([3-9]|\d{2})/.test(m)) return { thinkingLevel: 'low' }; // Gemini 3+ and -latest aliases
    return null;
  }
  const ANTHROPIC_FALLBACK = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/; // models with server-side refusal fallback
  const CALLERS = {
    async gemini(cfg, model, system, prompt, json) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
      };
      // Newer Gemini models think at a high level by default, which on the free tier can take over a minute even for
      // "Say OK" (report R-20261121-XX1QF). Resume work doesn't need deep thinking: ask for a low level (2.5: a small budget).
      const thinking = geminiThinking(model);
      if (thinking) body.generationConfig.thinkingConfig = thinking;
      const send = (b) => fetchJson(url, {
        timeoutMs: cfg.timeoutMs,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.keys.gemini },
        body: JSON.stringify(b),
      });
      let data;
      try {
        data = await send(body);
      } catch (e) {
        // A model that doesn't accept this thinking setting answers 400: ask again without it, once.
        const x = AJP.toAppError(e);
        if (!thinking || !/thinking/i.test(String((x.details && x.details.body) || ''))) throw e;
        AJP.logger('ai').info('Gemini model rejected the thinking setting; retrying without it', { model });
        delete body.generationConfig.thinkingConfig;
        data = await send(body);
      }
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || '').join('');
    },
    groq(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', cfg.keys.groq, model, system, prompt, json, { timeoutMs: cfg.timeoutMs });
    },
    openrouter(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', cfg.keys.openrouter, model, system, prompt, json, {
        headers: { 'X-Title': 'Apply Job Assistant' },
        timeoutMs: cfg.timeoutMs,
      });
    },
    nvidia(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://integrate.api.nvidia.com/v1/chat/completions', cfg.keys.nvidia, model, system, prompt, json, { jsonMode: false, timeoutMs: cfg.timeoutMs });
    },
    mistral(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://api.mistral.ai/v1/chat/completions', cfg.keys.mistral, model, system, prompt, json, { timeoutMs: cfg.timeoutMs });
    },
    // Anthropic Messages API. Raw HTTP through AJP.http (no build step, so no SDK bundle), from the background only.
    // Current models think adaptively; only the text blocks are the answer. A safety refusal (HTTP 200,
    // stop_reason "refusal") is a coded error; models that support it get Anthropic's server-side fallback.
    async anthropic(cfg, model, system, prompt, json) {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': cfg.keys.anthropic,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // the call is made from the extension, with the user's own key
      };
      const body = {
        model,
        max_tokens: 16000,
        system: json ? system + '\n\nReply with ONE valid JSON object only, no other text.' : system,
        messages: [{ role: 'user', content: prompt }],
      };
      if (ANTHROPIC_FALLBACK.test(model)) {
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        body.fallbacks = 'default';
      }
      const data = await fetchJson('https://api.anthropic.com/v1/messages', { timeoutMs: cfg.timeoutMs, method: 'POST', headers, body: JSON.stringify(body) });
      if (data.stop_reason === 'refusal') {
        throw AJP.err('AI_REFUSED', { provider: 'anthropic', category: (data.stop_details && data.stop_details.category) || null });
      }
      return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
    },
    async ollama(cfg, model, system, prompt, json) {
      const base = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const data = await fetchJson(base + '/api/chat', {
        timeoutMs: cfg.timeoutMs,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      return (data.message && data.message.content) || '';
    },
  };

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
    nvidia: [/^meta\/llama-3\.3-70b-instruct$/, /^openai\/gpt-oss-120b$/, /^qwen\/qwen3/, /^deepseek-ai\/deepseek/, /^meta\/llama-4/, /^mistralai\/mistral-(medium|large)/, /instruct$/],
    mistral: [/^mistral-medium-latest$/, /^mistral-small-latest$/, /^mistral-large-latest$/, /^mistral-(medium|small|large)/],
    anthropic: [/^claude-opus-5-5$/, /^claude-sonnet-5-5$/, /^claude-opus-\d/, /^claude-sonnet-\d/, /^claude-haiku-\d/],
  };
  const UPSTREAM_BUSY = /rate-limited upstream|temporarily rate.?limited|provider returned error/i;
  const NOT_CHAT = /whisper|tts|guard|embed|vision-preview|playai|distil|compound|image|audio|aqa|learnlm|gemma-3n|ocr|moderation|rerank|retriever|safety|parakeet|clip|pixtral|voxtral/i;
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
   *   cooldown:     gone 24 h · slow 6 h · busy 1 h · quota until it resets (daily → 24 h), then another chance
   *   on success:   that model is remembered and its cooldown cleared
   */
  const DAY = 24 * 3600 * 1000;
  const COOLDOWN = { gone: DAY, slow: 6 * 3600 * 1000, busy: 3600 * 1000, quota: 3600 * 1000 };
  // Out of quota: until the provider says (Retry-After / "retry in 40s"), a daily quota until tomorrow, else an hour.
  function quotaCooldown(x) {
    const body = String((x.details && x.details.body) || '');
    if (/limit:\s*0\b/.test(body)) return DAY; // not in the free tier at all: don't try it again today
    if (/per ?day|daily|RequestsPerDay/i.test(body)) return DAY;
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
    if (x.code === 'AJP-AI-404') return 'gone';
    if (x.code === 'AJP-AI-HTTP' && /deprecat|no longer (available|supported)|decommission|not (found|supported|available) for|unknown model|invalid model|model .*(not exist|unavailable)/i.test(body)) return 'gone';
    if (x.code === 'AJP-AI-TIME') return 'slow';
    if (x.code === 'AJP-AI-429' && UPSTREAM_BUSY.test(body)) return 'busy';
    if (x.code === 'AJP-AI-5XX') return 'busy'; // "model is overloaded" / server error on this model: another model, not the same one again
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
    await AJP.store.update('modelHealth', (all) => void (all[provider] = { ...(all[provider] || {}), ...(ranked.length ? { ranked } : {}), at: Date.now() }));
    return ranked;
  }
  async function setAside(provider, model, why, ms = COOLDOWN[why]) {
    if (why === 'gone') ms = COOLDOWN.gone;
    await AJP.store.update('modelHealth', (all) => {
      const h = (all[provider] = all[provider] || {});
      const now = Date.now();
      h.bad = Object.fromEntries(Object.entries(h.bad || {}).filter(([, until]) => until > now));
      h.bad[model] = now + ms;
      h.why = { ...(h.why || {}), [model]: why };
      if (h.last === model) h.last = '';
      if (why === 'gone' && h.ok) delete h.ok[model];
    });
  }
  async function worked(provider, model) {
    await AJP.store.update('modelHealth', (all) => {
      const h = (all[provider] = all[provider] || {});
      h.last = model;
      h.ok = { ...(h.ok || {}), [model]: Date.now() };
      if (h.bad) delete h.bad[model];
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
  async function complete({ system, prompt, json = false, task = 'complete', tid, group = '', patient = false, timeoutMs, via = '' }) {
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
    let list = candidates(provider, pinned, cfg, health);
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
    const once = async (text) => {
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
    const call = async (text) => {
      for (;;) {
        try {
          return await once(text);
        } catch (e) {
          const x = AJP.toAppError(e);
          const why = PREFER[provider] ? switchReason(x, provider) : null;
          if (!why || switches >= CONFIG.maxSwitches || (why === 'slow' && slowSwitched)) throw e;
          tried.add(model);
          await setAside(provider, model, why, why === 'quota' ? quotaCooldown(x) : undefined);
          if (why !== 'gone' && performance.now() - t0 > CONFIG.chainMs) {
            path.push({ model, why });
            throw e; // the provider is having a bad moment: tell the user now instead of trying more models
          }
          let next = list.find((m) => !tried.has(m));
          if (!refreshed && (why === 'gone' || stale || !next)) {
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
          tr.log.info(`ai.${task} model "${model}" ${({ gone: 'not offered any more', slow: 'too slow', busy: 'busy', quota: 'out of free quota' })[why]}; trying "${next}"`, { provider, from: model, to: next, why });
          model = next;
        }
      }
    };
    try {
      let out = await call(prompt);
      if (!out || !String(out).trim()) throw AJP.err('AI_BAD_RESPONSE', { reason: 'empty answer' });
      let result;
      if (json) {
        try {
          result = parseJsonLoose(out);
        } catch (e) {
          // Free models sometimes add prose or break JSON: retry once with a firm reminder.
          tr.log.warn(`ai.${task} invalid JSON, retrying once`, { reason: e.details && e.details.reason });
          out = await call(prompt + '\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONE valid JSON object only, no other text.');
          result = parseJsonLoose(out);
        }
      } else result = out.trim();
      tr.end({ provider, model, outChars: out.length });
      if (PREFER[provider]) await worked(provider, model);
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
    const options = ['groq', 'nvidia', 'mistral', 'gemini', 'openrouter', 'anthropic']
      .filter((k) => k !== current && cfg.keys && cfg.keys[k])
      .map((k) => ({ id: k, label: name(k), paid: !!PROVIDERS[k].paid }));
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

  AJP.ai = { PROVIDERS, CONFIG, complete, tasks, parseJsonLoose, label: LABEL, last: null, models: { refreshAll, rank: rankModels }, alternatives, local: { api: localApi, status: localStatus, download: localDownload, fitPrompt } };
})();
