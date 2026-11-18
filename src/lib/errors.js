/*
 * errors.js — one catalog of error codes.
 *
 * Every failure the user can see has a short code (e.g. AJP-AI-429). The code appears in the UI
 * message, in the logs, and in issue reports, so support can find the cause quickly.
 *
 *   throw AJP.err('AI_RATE_LIMIT', { provider: 'groq' });
 *   catch (e) { const x = AJP.toAppError(e); x.code; x.message; x.hint; }
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.ERRORS) return;

  // key: [code, user message, hint]
  const ERRORS = {
    AI_OFF: ['AJP-AI-OFF', 'AI is turned off.', 'Pick a free provider in Admin → AI settings.'],
    AI_NO_KEY: ['AJP-AI-KEY', 'No API key saved for this AI provider.', 'Add the key in Admin → AI settings, then click Test connection.'],
    AI_AUTH: ['AJP-AI-401', 'The AI provider rejected the API key.', 'Check the key in Admin → AI settings (copy it again from the provider).'],
    AI_RATE_LIMIT: ['AJP-AI-429', 'The free AI limit was reached.', 'Wait a minute and try again, or switch provider in Admin → AI settings.'],
    AI_MODEL: ['AJP-AI-404', 'The AI model name was not found.', 'Clear the Model field in Admin → AI settings to use the default.'],
    AI_SERVER: ['AJP-AI-5XX', 'The AI provider had a server error.', 'Try again shortly.'],
    AI_HTTP: ['AJP-AI-HTTP', 'The AI request failed.', 'See the logs for the provider response.'],
    AI_TIMEOUT: ['AJP-AI-TIME', 'The AI took too long to answer.', 'Try again; long resumes and job posts take longer.'],
    AI_NETWORK: ['AJP-AI-NET', 'Could not reach the AI provider.', 'Check your internet connection. For Ollama, make sure it is running (OLLAMA_ORIGINS="*" ollama serve).'],
    AI_BAD_RESPONSE: ['AJP-AI-FMT', 'The AI answer could not be understood.', 'Try again, or pick a larger model.'],
    PAGE_NO_ACCESS: ['AJP-PAGE-ACCESS', 'This page cannot be read by extensions.', 'Browser pages, extension stores and some PDF viewers are off-limits. Open the job in a normal tab.'],
    JD_NOT_FOUND: ['AJP-JD-NONE', 'Could not find a job description on this page.', 'Select the job text, right-click → “Apply Job: analyze selection”.'],
    NO_RESUME: ['AJP-RES-NONE', 'No resume text found.', 'Add your resume in Admin → Resumes (paste the text for PDFs).'],
    RESUME_STRUCTURE: ['AJP-RES-STRUCT', 'Could not find bullet points in your resume.', 'Put each achievement on its own line starting with "-" or "•" (Admin → Resumes), then try again.'],
    ENHANCEMENT_MISSING: ['AJP-RES-DRAFT', 'This resume draft is no longer available.', 'Run “Tailor resume” again from the job page.'],
    RESUME_CHANGED: ['AJP-RES-CHANGED', 'Your resume was edited after this draft was made.', 'Run “Tailor resume” again so the suggestions match your current resume.'],
        RESUME_PARSE: ['AJP-RES-PARSE', 'Could not read text from this resume file.', 'Paste the resume text in Admin → Resumes.'],
    FILE_TOO_LARGE: ['AJP-FILE-SIZE', 'The file is too large (max 5 MB).', 'Use a smaller PDF/DOCX.'],
    BACKUP_INVALID: ['AJP-BACKUP', 'Not an Apply Job backup file.', 'Choose a file exported from Admin → Backup.'],
    STORAGE: ['AJP-STORE', 'Could not save data in the browser.', 'The browser storage may be full or blocked. Export a backup and free space.'],
    NO_TAB: ['AJP-TAB', 'No browser tab to work with.', 'Click the extension icon on the job page.'],
    NETWORK: ['AJP-NET', 'Could not reach the service.', 'Check your internet connection and try again.'],
    HTTP: ['AJP-HTTP', 'The service returned an error.', 'Try again in a minute. If it keeps happening, report it.'],
    INTERNAL: ['AJP-INTERNAL', 'Something went wrong.', 'Download logs from Admin → Logs → Report an issue and send them to support.'],
  };

  class AppError extends Error {
    constructor(key, details, cause) {
      const [code, message, hint] = ERRORS[key] || ERRORS.INTERNAL;
      super(message);
      this.name = 'AppError';
      this.key = ERRORS[key] ? key : 'INTERNAL';
      this.code = code;
      this.hint = hint;
      this.details = details || null;
      if (cause) this.cause = cause;
    }
    toJSON() {
      return { code: this.code, message: this.message, hint: this.hint, details: this.details };
    }
  }

  const err = (key, details, cause) => new AppError(key, details, cause);

  // Normalize anything thrown into an AppError (unknown errors become AJP-INTERNAL, keeping the original text).
  function toAppError(e) {
    if (e instanceof AppError) return e;
    if (e && typeof e.code === 'string' && e.code.startsWith('AJP-')) {
      // A serialized error (e.g. a failed background reply {ok:false, error, code, hint}).
      return { code: e.code, message: e.message || e.error || 'Error', hint: e.hint || '', details: e.details || null, key: e.key };
    }
    const x = err('INTERNAL', { original: String((e && e.message) || e) }, e);
    return x;
  }

  // HTTP status from an AI provider -> error key.
  function aiErrorForStatus(status) {
    if (status === 401 || status === 403) return 'AI_AUTH';
    if (status === 429) return 'AI_RATE_LIMIT';
    if (status === 404) return 'AI_MODEL';
    if (status >= 500) return 'AI_SERVER';
    return 'AI_HTTP';
  }

  // What the UI shows: message + hint + code.
  function describe(e) {
    const x = toAppError(e);
    return { code: x.code, message: x.key === 'INTERNAL' && x.details ? `${x.message} (${x.details.original})` : x.message, hint: x.hint };
  }

  AJP.ERRORS = ERRORS;
  AJP.AppError = AppError;
  AJP.err = err;
  AJP.toAppError = toAppError;
  AJP.aiErrorForStatus = aiErrorForStatus;
  AJP.describeError = describe;

  /* =====================================================================================
   * THE STANDARD for failures (docs/ARCHITECTURE.md §9b). Use these, not ad-hoc code:
   *   AJP.err(KEY)        every failure a user can see has a code + message + hint
   *   AJP.retry(fn)       temporary failures retry with backoff; permanent ones fail fast
   *   AJP.http(url)       the ONLY way to call the network: timeout, retries, coded errors
   *   AJP.guard(name,fn)  every user action: trace + timing + log + clear message, never throws
   * Logged errors with a code feed the crash prompt (issue-report.js) automatically.
   * ===================================================================================== */

  // Temporary failures worth retrying. Wrong keys, missing data, bad input etc. are permanent.
  const TRANSIENT = new Set(['AJP-AI-5XX', 'AJP-AI-NET', 'AJP-NET', 'AJP-HTTP', 'AJP-STORE']);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isTransient(e) {
    const x = toAppError(e);
    if (x.code === 'AJP-AI-429') return !!(x.details && x.details.retryAfter && x.details.retryAfter <= 10); // only short, server-told waits
    if (x.code === 'AJP-HTTP') return !!(x.details && x.details.status >= 500);
    return TRANSIENT.has(x.code);
  }

  /*
   * retry(fn, { tries=3, baseMs=400, maxMs=4000, retryOn=isTransient, label, log })
   *   fn(attempt) is called up to `tries` times; waits base·2^n (+ jitter, or the server's Retry-After) between.
   */
  async function retry(fn, { tries = 3, baseMs = 400, maxMs = 4000, retryOn = isTransient, label = 'operation', log } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await fn(attempt);
      } catch (e) {
        lastErr = e;
        if (attempt >= tries || !retryOn(e)) throw e;
        const x = toAppError(e);
        const wait = x.details && x.details.retryAfter ? x.details.retryAfter * 1000 : Math.min(maxMs, baseMs * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4);
        if (log) log.warn(`${label}: retrying (attempt ${attempt + 1}/${tries})`, { code: x.code, waitMs: Math.round(wait) });
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  /*
   * http(url, opts, { timeoutMs=15000, tries=2, json=true, statusKey, networkKey='NETWORK', timeoutKey='NETWORK', log, label })
   *   -> parsed JSON (or text). Errors are AppErrors with details {status, body, host, retryAfter}.
   */
  async function http(url, opts = {}, { timeoutMs = 15000, tries = 2, json = true, statusKey = () => 'HTTP', networkKey = 'NETWORK', timeoutKey = 'NETWORK', badJsonKey = 'HTTP', log, label = 'http' } = {}) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch (_) {
        return ''; // relative or malformed URL: host is only used in error details
      }
    })();
    return retry(
      async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let res;
        try {
          res = await fetch(url, { ...opts, signal: ctrl.signal });
        } catch (e) {
          if (e.name === 'AbortError') throw err(timeoutKey, { host, timeoutMs, seconds: timeoutMs / 1000 }, e);
          throw err(networkKey, { host, original: e.message }, e);
        } finally {
          clearTimeout(timer);
        }
        const text = await res.text();
        if (!res.ok) {
          const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '', 10);
          throw err(statusKey(res.status), { status: res.status, body: text.slice(0, 300), host, retryAfter: isNaN(ra) ? undefined : ra });
        }
        if (!json) return text;
        try {
          return JSON.parse(text);
        } catch (e) {
          throw err(badJsonKey, { reason: 'response was not JSON', body: text.slice(0, 200), host }, e);
        }
      },
      { tries, log, label }
    );
  }

  /*
   * guard(name, fn, { mod, onError, slowMs }) -> async (...args) => result | undefined
   *   For user actions (buttons, panel actions, Admin handlers). Never throws: failures are traced, logged with
   *   their code (which also feeds the crash prompt), and handed to onError({code, message, hint}) for the UI.
   */
  function guard(name, fn, { mod = 'ui', onError, slowMs = 5000 } = {}) {
    return async (...args) => {
      const tr = AJP.startTrace ? AJP.startTrace(name, { mod, slowMs }) : null;
      try {
        const out = await fn(...args, tr);
        if (tr) tr.end();
        return out;
      } catch (e) {
        const x = tr ? tr.fail(e) : toAppError(e);
        if (onError) {
          try {
            onError(describe(x), x);
          } catch (_) {
            /* the error display itself failed: the failure is already logged above */
          }
        }
        return undefined;
      }
    };
  }

  AJP.isTransient = isTransient;
  AJP.retry = retry;
  AJP.http = http;
  AJP.guard = guard;
})();
