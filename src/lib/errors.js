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
    AI_CUT: ['AJP-AI-CUT', 'The AI\'s answer was cut off before it finished.', 'Try again, or choose another model or provider in Admin → AI settings.'],
    AI_TOO_LARGE: ['AJP-AI-BIG', 'This resume and job are too long for this AI\'s limit.', 'Choose a provider with a larger limit (Gemini, NVIDIA NIM or Mistral) in Admin → AI settings.'],
    AI_OFF: ['AJP-AI-OFF', 'AI is turned off.', 'Pick a free provider in Admin → AI settings.'],
    AI_NO_KEY: ['AJP-AI-KEY', 'No API key saved for this AI provider.', 'Add the key in Admin → AI settings, then click Test connection.'],
    RADAR_UNSUPPORTED: ["AJP-RADAR-UNSUP", "This careers page uses a job board Job Radar can't read yet.", "Supported: Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, SmartRecruiters, Workday, Breezy HR, Teamtailor, Rippling."],
    RADAR_BOARD_NOT_FOUND: ["AJP-RADAR-404", "No job board was found for this company.", "Check the company name in the careers URL; SmartRecruiters and Workday names are case-sensitive."],
    RADAR_PERMISSION: ["AJP-RADAR-PERM", "The browser did not allow access to this job board.", "Add the company again in Admin → Job Radar and click Allow."],
    RADAR_RATE_LIMIT: ["AJP-RADAR-429", "The job board asked us to slow down.", "Nothing to do; it is retried on the next scan."],
    RADAR_SERVER: ["AJP-RADAR-5XX", "The job board had a server error.", "It is retried on the next scan."],
    RADAR_NETWORK: ["AJP-RADAR-NET", "Could not reach the job board.", "Check your internet connection."],
    RADAR_TIMEOUT: ["AJP-RADAR-TIME", "The job board took too long to answer.", "It is retried on the next scan."],
    RADAR_BAD_RESPONSE: ["AJP-RADAR-FMT", "The job board's answer could not be read.", "The board may have changed its format; please report it from Logs & support."],
    RADAR_PAUSED: ["AJP-RADAR-PAUSED", "This company was paused after 5 failed scans in a row.", "Check its URL, then resume it in the watchlist."],
    RADAR_LIST: ["AJP-RADAR-LIST", "Some lines in the list could not be added.", "Each skipped line shows the reason; check the URL or add it by hand."],
    RADAR_BUSY: ["AJP-RADAR-BUSY", "A Job Radar scan is already running.", "Wait for it to finish; the results appear in Job Radar → New jobs."],
    AI_CREDIT: ['AJP-AI-CREDIT', 'Your Anthropic account has no API credit left.', 'Claude API keys are paid per use: add credit at console.anthropic.com → Billing, or choose a free provider (Groq, Gemini, NVIDIA NIM, Mistral) in Admin → AI settings.'],
    AI_REFUSED: ['AJP-AI-REFUSED', 'The AI declined to answer this request.', 'Try again; if it keeps happening, choose another provider or model in Admin → AI settings.'],
    AI_AUTH: ['AJP-AI-401', 'The AI provider rejected the API key.', 'Check the key in Admin → AI settings (copy it again from the provider).'],
    AI_RATE_LIMIT: ['AJP-AI-429', 'The free AI limit was reached.', 'Wait a minute and try again, or switch provider in Admin → AI settings.'],
    AI_MODEL: ['AJP-AI-404', 'The AI model name was not found, and no replacement could be found.', 'Clear the Model field in Admin → AI settings and try again; if it keeps failing, the provider may have changed its models: try another provider.'],
    AI_SERVER: ['AJP-AI-5XX', 'The AI provider had a server error.', 'Try again shortly.'],
    AI_BILLING: ['AJP-AI-BILLING', "This AI provider's free tier isn't available for your account or project.", 'Use Groq instead (free, no billing: console.groq.com/keys), try another personal Google account, or set up billing with the provider. Then choose it in Admin → AI settings.'],
    AI_HTTP: ['AJP-AI-HTTP', 'The AI request failed.', 'See the logs for the provider response.'],
    AI_TIMEOUT: ['AJP-AI-TIME', 'The AI took too long to answer.', 'Try again; long resumes and job posts take longer.'],
    AI_NETWORK: ['AJP-AI-NET', 'Could not reach the AI provider.', 'Check your internet connection. For Ollama, make sure it is running (OLLAMA_ORIGINS="*" ollama serve).'],
    AI_BAD_RESPONSE: ['AJP-AI-FMT', 'The AI answer could not be understood.', 'Try again, or pick a larger model.'],
    TAILOR_LOW_MATCH: ['AJP-TAILOR-LOW', 'This job is not a close enough match to tailor your resume for.', 'Tailoring is for jobs that already match well (70%+ by default, Admin → AI settings → Tailoring limits). Honest edits add about 10–15 points; focus on closer jobs or build the missing skills.'],
    AI_LOCAL_UNSUPPORTED: ['AJP-AI-LOCAL-NONE', "This browser doesn't have built-in AI.", 'Use a recent desktop Chrome (138 or newer) or pick another free provider in Admin → AI settings.'],
    AI_LOCAL_UNAVAILABLE: ['AJP-AI-LOCAL-OFF', "Chrome's built-in AI can't run on this computer right now.", 'It needs a desktop computer with enough free disk space (about 22 GB) and memory; see chrome://on-device-internals. Or pick another free provider.'],
    AI_LOCAL_DOWNLOAD: ['AJP-AI-LOCAL-DL', "Chrome's built-in AI model isn't downloaded yet.", 'Open Admin → AI settings and click "Download the on-device model" (one time), then try again.'],
    AI_LOCAL_TOO_LONG: ['AJP-AI-LOCAL-LEN', 'The resume and job post are too long for the on-device model.', 'Shorten the resume, or use a cloud provider (Gemini or Groq) for this job.'],
    PAGE_NO_ACCESS: ['AJP-PAGE-ACCESS', 'This page cannot be read by extensions.', 'Browser pages, extension stores and some PDF viewers are off-limits. Open the job in a normal tab.'],
    JD_NOT_FOUND: ['AJP-JD-NONE', 'Could not find a job description on this page.', 'Select the job text, right-click → “Apply Job: analyze selection”.'],
    NO_RESUME: ['AJP-RES-NONE', 'No resume text found.', 'Add your resume in Admin → Resumes (paste the text for PDFs).'],
    PDF_CREATE: ['AJP-PDF-CREATE', 'Could not create the PDF of this resume.', 'Check that the resume has text, then try again; or upload your own PDF.'],
    PDF_NO_TEXT: ['AJP-PDF-NOTEXT', 'This PDF has no selectable text (it may be a scanned image).', 'Upload the .docx version, or paste the resume text in the box.'],
    PDF_LOCKED: ['AJP-PDF-LOCKED', 'This PDF is password-protected.', 'Save it again without a password (Print → Save as PDF), upload the .docx, or paste the text.'],
    RESUME_STRUCTURE: ['AJP-RES-STRUCT', 'Could not find your achievements in the resume.', 'Open Admin → Resumes: click "Mark achievement lines as bullets", or put each achievement on its own line starting with "-" (Word files: upload again, bullets are read now). Then try again.'],
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
    if (status === 413) return 'AI_TOO_LARGE';
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

  /*
   * httpStream(url, opts, sink, { format: 'sse'|'ndjson', firstByteMs, idleMs, totalMs, tries, statusKey, networkKey,
   *            timeoutKey, badJsonKey, log, label }) -> { streamed }
   * Feeds every event to sink.event(obj). A server that ignores streaming and answers with one JSON body also works.
   * Timeouts: until the answer starts, between pieces, and overall. Only failures before any data are retried.
   */
  function parseEvents(format, onEvent) {
    let buf = '';
    let data = [];
    const dispatch = (s) => {
      const t = s.trim();
      if (!t || t === '[DONE]') return;
      try {
        onEvent(JSON.parse(t));
      } catch (e) {
        if (e instanceof SyntaxError) parseEvents.bad++;
        else throw e;
      }
    };
    const line = (l) => {
      if (format === 'ndjson') return dispatch(l);
      if (l === '' || l === '\r') {
        if (data.length) dispatch(data.join('\n'));
        data = [];
      } else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, '').replace(/\r$/, ''));
      return undefined; // SSE comments ("": OPENROUTER PROCESSING) and event names are ignored
    };
    return {
      push(chunk) {
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop();
        parts.forEach(line);
      },
      end() {
        if (buf) line(buf);
        buf = '';
        if (format !== 'ndjson' && data.length) dispatch(data.join('\n'));
        data = [];
      },
    };
  }
  parseEvents.bad = 0;
  // An extension API call resets Chrome's idle timer for the background worker during a long answer.
  function keepWorkerAwake() {
    const api = AJP.api;
    if (!api || !api.runtime || !api.runtime.getPlatformInfo) return () => {};
    const id = setInterval(() => {
      Promise.resolve(api.runtime.getPlatformInfo()).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }
  async function httpStream(url, opts = {}, sink, { format = 'sse', firstByteMs = 28000, idleMs = 30000, totalMs = 120000, tries = 2, statusKey = () => 'HTTP', networkKey = 'NETWORK', timeoutKey = 'NETWORK', badJsonKey = 'HTTP', log, label = 'stream' } = {}) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch (_) {
      host = ''; // relative URL (tests): host is only used in error details
    }
    return retry(
      async () => {
        sink.reset();
        const ctrl = new AbortController();
        let timer = setTimeout(() => ctrl.abort(), Math.min(firstByteMs, totalMs));
        const overall = setTimeout(() => ctrl.abort(), totalMs);
        const asleep = keepWorkerAwake();
        const beat = () => {
          clearTimeout(timer);
          timer = setTimeout(() => ctrl.abort(), idleMs);
        };
        const timedOut = (e) => err(timeoutKey, { host, timeoutMs: totalMs, seconds: Math.round(totalMs / 1000) }, e);
        try {
          let res;
          try {
            res = await fetch(url, { ...opts, signal: ctrl.signal });
          } catch (e) {
            if (e.name === 'AbortError') throw timedOut(e);
            throw err(networkKey, { host, original: e.message }, e);
          }
          beat();
          if (!res.ok) {
            const text = await res.text();
            const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '', 10);
            throw err(statusKey(res.status), { status: res.status, body: text.slice(0, 600), host, retryAfter: isNaN(ra) ? undefined : ra });
          }
          const type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
          const streaming = /event-stream|ndjson/i.test(type) && res.body && res.body.getReader;
          if (!streaming) {
            // One plain JSON body (or SSE text from a proxy that buffers).
            const text = await res.text();
            let whole;
            try {
              whole = JSON.parse(text);
            } catch (_) {
              whole = undefined;
            }
            if (whole !== undefined) sink.event(whole);
            else {
              let got = 0;
              const p = parseEvents(/^\s*(data:|:)/.test(text) ? 'sse' : format, (ev) => {
                got++;
                sink.event(ev);
              });
              p.push(text);
              p.end();
              if (!got) throw err(badJsonKey, { reason: 'response was not JSON', body: text.slice(0, 200), host });
            }
            return { streamed: false };
          }
          const r = res.body.getReader();
          const dec = new TextDecoder();
          const p = parseEvents(format, (ev) => sink.event(ev));
          try {
            for (;;) {
              const { value, done } = await r.read();
              if (done) break;
              beat();
              p.push(dec.decode(value, { stream: true }));
            }
          } catch (e) {
            if (e.name === 'AbortError') throw timedOut(e);
            throw err(networkKey, { host, original: e.message, midStream: true }, e);
          }
          p.push(dec.decode());
          p.end();
          return { streamed: true };
        } finally {
          clearTimeout(timer);
          clearTimeout(overall);
          asleep();
        }
      },
      { tries, log, label }
    );
  }

  AJP.httpStream = httpStream;
  AJP.isTransient = isTransient;
  AJP.retry = retry;
  AJP.http = http;
  AJP.guard = guard;
})();
