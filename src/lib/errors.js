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
    RESUME_PARSE: ['AJP-RES-PARSE', 'Could not read text from this resume file.', 'Paste the resume text in Admin → Resumes.'],
    FILE_TOO_LARGE: ['AJP-FILE-SIZE', 'The file is too large (max 5 MB).', 'Use a smaller PDF/DOCX.'],
    BACKUP_INVALID: ['AJP-BACKUP', 'Not an Apply Job backup file.', 'Choose a file exported from Admin → Backup.'],
    STORAGE: ['AJP-STORE', 'Could not save data in the browser.', 'The browser storage may be full or blocked. Export a backup and free space.'],
    NO_TAB: ['AJP-TAB', 'No browser tab to work with.', 'Click the extension icon on the job page.'],
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
})();
