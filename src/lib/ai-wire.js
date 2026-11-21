/*
 * ai-wire.js — how to talk to each cloud AI provider, in one place (docs/ARCHITECTURE.md §8.5).
 *
 *   PROFILES   what each provider needs: endpoint, JSON method, output limit, free-tier pace
 *   build()    the HTTP request for one call (always streaming: Chrome can stop an extension's background worker
 *              when a fetch answer takes over 30 s to arrive, so the answer must start arriving early)
 *   reader()   collects a streamed (or plain JSON) reply into { text, finish, error, category }
 *              finish: 'stop' | 'length' (cut off) | 'refused' | 'error' | null (the stream just ended)
 *   fixFor()   a 400 that names a setting this model rejects → which setting to drop on the retry
 *   reasonFrom() the provider's own words from an error body
 *
 * Pure functions: no network, no storage.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.aiWire) return;

  const JSON_ONLY = '\n\nReply with ONE valid JSON object only, no other text.';
  const PROFILES = {
    // Groq's limits count the output allowance too: keep it small enough for its free per-minute budget.
    groq: { kind: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', maxOutput: 2500, maxOutputCap: 3500, tpm: 8000 },
    openrouter: { kind: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', maxOutput: 4096, maxOutputCap: 8192, headers: { 'X-Title': 'Apply Job Assistant' } },
    nvidia: { kind: 'openai', url: 'https://integrate.api.nvidia.com/v1/chat/completions', maxOutput: 4096, maxOutputCap: 8192, noJsonMode: true },
    mistral: { kind: 'openai', url: 'https://api.mistral.ai/v1/chat/completions', maxOutput: 4096, maxOutputCap: 8192 },
    gemini: { kind: 'gemini', maxOutput: 8192, maxOutputCap: 16384 },
    anthropic: { kind: 'anthropic', url: 'https://api.anthropic.com/v1/messages', maxOutput: 16000, maxOutputCap: 32000 },
    ollama: { kind: 'ollama', maxOutput: null, maxOutputCap: null, local: true },
  };
  const ANTHROPIC_FALLBACK = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/; // models with server-side refusal fallback

  function geminiThinking(model) {
    const m = String(model);
    if (/^gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 }; // 2.5 Flash / Flash-Lite: thinking off
    if (/^gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 }; // 2.5 Pro: the minimum
    if (/^gemini-(flash|pro)/.test(m) || /^gemini-([3-9]|\d{2})/.test(m)) return { thinkingLevel: 'low' }; // Gemini 3+ and -latest aliases
    return null;
  }

  /*
   * build({ provider, key, model, system, prompt, json, baseUrl, quirks })
   * quirks (learned per model): noJsonMode, noTemperature, noThinking; maxOutput overrides the profile.
   */
  function build({ provider, key, model, system, prompt, json, baseUrl, quirks = {} }) {
    const p = PROFILES[provider];
    const maxOutput = quirks.maxOutput || p.maxOutput;
    if (p.kind === 'openai') {
      const jsonMode = json && !p.noJsonMode && !quirks.noJsonMode;
      const body = {
        model,
        stream: true,
        max_tokens: maxOutput,
        messages: [
          { role: 'system', content: json && !jsonMode ? system + JSON_ONLY : system },
          { role: 'user', content: prompt },
        ],
      };
      if (!quirks.noTemperature) body.temperature = 0.3;
      if (jsonMode) body.response_format = { type: 'json_object' };
      return { format: 'sse', url: p.url, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(p.headers || {}) }, body };
    }
    if (p.kind === 'gemini') {
      const generationConfig = { maxOutputTokens: maxOutput, ...(json && !quirks.noJsonMode ? { responseMimeType: 'application/json' } : {}) };
      if (!quirks.noTemperature) generationConfig.temperature = 0.3;
      const thinking = quirks.noThinking ? null : geminiThinking(model);
      if (thinking) generationConfig.thinkingConfig = thinking;
      return {
        format: 'sse',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: json && quirks.noJsonMode ? system + JSON_ONLY : system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig,
        },
      };
    }
    if (p.kind === 'anthropic') {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // the call is made from the extension, with the user's own key
      };
      const body = { model, stream: true, max_tokens: maxOutput, system: json ? system + JSON_ONLY : system, messages: [{ role: 'user', content: prompt }] };
      if (ANTHROPIC_FALLBACK.test(model)) {
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        body.fallbacks = 'default';
      }
      return { format: 'sse', url: p.url, headers, body };
    }
    // Ollama: newline-delimited JSON
    return {
      format: 'ndjson',
      url: String(baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat',
      headers: { 'Content-Type': 'application/json' },
      body: { model, stream: true, ...(json ? { format: 'json' } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] },
    };
  }

  // ---- Reading replies (each event of a stream, or one plain JSON body) ------------------------------
  const GEMINI_BLOCKED = /^(SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|LANGUAGE|IMAGE_SAFETY)$/;
  const EVENT = {
    openai(ev, r) {
      if (ev.error) r.error = ev.error;
      const c = ev.choices && ev.choices[0];
      if (!c) return;
      if (c.error) r.error = c.error; // OpenRouter: a failure inside an HTTP 200
      const m = c.delta || c.message || {};
      if (typeof m.content === 'string') r.text += m.content;
      if (m.refusal) r.finish = 'refused';
      if (m.reasoning || m.reasoning_content) r.thinking = true;
      if (c.finish_reason === 'length') r.finish = 'length';
      else if (c.finish_reason === 'content_filter') r.finish = 'refused';
      else if (c.finish_reason === 'error') r.finish = 'error';
      else if (c.finish_reason && !r.finish) r.finish = 'stop';
    },
    gemini(ev, r) {
      if (ev.error) r.error = ev.error;
      if (ev.promptFeedback && ev.promptFeedback.blockReason) {
        r.finish = 'refused';
        r.category = ev.promptFeedback.blockReason;
      }
      const c = ev.candidates && ev.candidates[0];
      if (!c) return;
      for (const part of (c.content && c.content.parts) || []) {
        if (part.thought) r.thinking = true;
        else if (part.text) r.text += part.text;
      }
      if (c.finishReason === 'MAX_TOKENS') r.finish = 'length';
      else if (GEMINI_BLOCKED.test(c.finishReason || '')) {
        r.finish = 'refused';
        r.category = c.finishReason;
      } else if (c.finishReason && !r.finish) r.finish = 'stop';
    },
    anthropic(ev, r) {
      if (ev.type === 'error' && ev.error) r.error = ev.error;
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') r.text += ev.delta.text || '';
      // A plain (non-streamed) message
      if (Array.isArray(ev.content)) for (const b of ev.content) if (b.type === 'text') r.text += b.text || '';
      const stop = (ev.delta && ev.delta.stop_reason) || (ev.type !== 'message_start' && ev.stop_reason);
      const details = (ev.delta && ev.delta.stop_details) || ev.stop_details;
      if (stop === 'max_tokens') r.finish = 'length';
      else if (stop === 'refusal') {
        r.finish = 'refused';
        r.category = (details && details.category) || null;
      } else if (stop) r.finish = 'stop';
    },
    ollama(ev, r) {
      if (ev.error) r.error = { message: ev.error };
      if (ev.message && ev.message.content) r.text += ev.message.content;
      if (ev.done) r.finish = ev.done_reason === 'length' ? 'length' : 'stop';
    },
  };
  function reader(provider) {
    const kind = PROFILES[provider].kind;
    const r = { text: '', finish: null, error: null, category: null, thinking: false };
    return {
      event: (ev) => ev && typeof ev === 'object' && EVENT[kind](ev, r),
      reset() {
        Object.assign(r, { text: '', finish: null, error: null, category: null, thinking: false });
      },
      result: () => ({ ...r }),
    };
  }

  // ---- Errors ------------------------------------------------------------------------------------------
  // The provider's own words, from a JSON or cut-off error body. Scrubbed by the caller's logger; kept short.
  function reasonFrom(body) {
    const s = String(body == null ? '' : body);
    if (!s.trim()) return '';
    let msg = '';
    try {
      const d = JSON.parse(s);
      const e = Array.isArray(d) ? d[0] && d[0].error : d.error || d;
      const raw = e && e.metadata && e.metadata.raw;
      msg = (typeof raw === 'string' && raw) || (typeof e === 'string' ? e : (e && (e.message || e.detail || e.title)) || d.detail || d.message || '');
    } catch (_) {
      const m = s.match(/"(?:raw|message|detail)"\s*:\s*"((?:[^"\\]|\\.)*)/);
      msg = m ? m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : s;
    }
    return String(msg).replace(/\s+/g, ' ').trim().slice(0, 220);
  }
  // A 400 / 422 that names a setting this model doesn't take → the quirk to set for the retry.
  function fixFor(x) {
    const status = x && x.details && x.details.status;
    if (![400, 404, 422].includes(status)) return null;
    const b = String((x.details && x.details.body) || '');
    if (/response_format|json_object|json mode|responseMimeType|response mime|structured output|json_validate_failed|failed to generate json/i.test(b)) return 'noJsonMode';
    if (/thinking/i.test(b)) return 'noThinking';
    if (/temperature/i.test(b)) return 'noTemperature';
    return null;
  }
  const TOO_LARGE = /too large|maximum context|context[_ ]length|reduce the length|exceeds? the (maximum|limit)|too many tokens|input is too long/i;
  const isTooLarge = (x) => !!(x && x.details && (x.details.status === 413 || ([400, 422].includes(x.details.status) && TOO_LARGE.test(String(x.details.body || '')))));

  AJP.aiWire = { PROFILES, JSON_ONLY, build, reader, reasonFrom, fixFor, isTooLarge, geminiThinking };
})();
