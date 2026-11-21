/*
 * storage.js — the "database". Everything lives in the browser's local
 * extension storage (storage.local) on this machine only. No server, no sync.
 *
 * Keys:
 *   profile       who the user is + preferences + auto-apply details
 *   settings      AI provider, log level, behaviour toggles
 *   resumes       { activeId, items: [{id,name,text,file?,createdAt,job?}] }
 *   answers       learned answers: { [normKey]: {label,value,count,lastUsed,hosts[]} }
 *   applications  [{id,url,title,company,score,status,date,resumeId}]
 *   enhancements  resume enhancement drafts: requirements, evidence, validated edits (max 20)
 *   logs          ring buffer of log entries (owned by background)
 *   tabJobs       internal: which job each browser tab is on (for apply detection)
 *
 * Reads go through an in-memory cache that is invalidated by storage.onChanged,
 * so repeated reads are effectively free.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.store) return;

  const DEFAULTS = {
    profile: {
      personal: {
        firstName: '', lastName: '', email: '', phone: '',
        address: '', city: '', state: '', zip: '', country: '',
        linkedin: '', github: '', website: '',
        currentTitle: '', currentCompany: '', yearsExperience: '',
      },
      skills: [], // CORE skills shared by every track: [{name, level, years}]
      tracks: [], // career tracks (max 3): [{id, name, targetTitles[], skills[], resumeId, salary?, workTypes?}] — see tracks.js
      targetRoles: [], // ["Senior Software Engineer", ...]
      salary: { min: '', max: '', currency: 'USD', period: 'year' },
      areas: [], // ["Austin, TX", "Remote - US"]
      workTypes: { remote: true, hybrid: true, onsite: false },
      willingToRelocate: '',
      autoApply: {
        education: [], // [{school, degree, field, startYear, endYear, gpa}]
        experience: [], // [{company, title, location, start, end, current, description}]
        workAuthorized: '', // 'Yes' | 'No'
        requireSponsorship: '',
        noticePeriod: '',
        earliestStart: '',
        coverLetterTemplate: '',
        eeo: { gender: '', race: '', hispanic: '', veteran: '', disability: '', pronouns: '' },
      },
    },
    settings: {
      ai: {
        provider: 'none', // none | gemini | groq | openrouter | ollama
        model: '',
        keys: { gemini: '', groq: '', openrouter: '', nvidia: '', mistral: '', anthropic: '' },
        tailorProvider: '', // '' = same as provider; e.g. 'gemini' for tailoring while 'chrome' does the rest
        tailorModel: '', // '' = the tailoring provider's default (e.g. claude-haiku-5-5 to spend less with Claude)
        resolvedModels: {}, // provider -> model found by discovery when the default was retired (see ai.js)
        ollamaUrl: 'http://localhost:11434',
      },
      logLevel: 'info',
      autoAnalyze: true, // show match badge automatically on known job sites
      learnAnswers: true,
      tracker: { autoDetect: true, followUpDays: 7 },
      retentionDays: 30, // applications, job history, drafts and logs older than this are removed (0 = keep)
      support: { crashPrompt: true }, // ask to report unnoticed failures (never sends without a click)
      // Resume tailoring is for CLOSE matches: small honest lift, never a rewrite (see resume-engine.js, "Limits").
      tailoring: { minMatch: 70, maxLift: 15, maxEdits: 6, maxSkills: 4 },
    },
    resumes: { activeId: null, items: [] },
    answers: {},
    applications: [],
    enhancements: [], // resume enhancement drafts awaiting review (max 20)
    evaluations: [], // last 300 analyzed jobs with a score per track (track insights)
    reports: [], // problem reports opened on GitHub: [{reportId, createdAt, codes, title, status, number, url, version, checkedAt, seen}]
    suggestions: { dismissed: {} }, // profile suggestions from learned answers: { dismissed: { [id]: isoDate } }
    aiCalls: [], // internal: last 30 AI calls {at, task, provider, model, label, ms, ok, code} — no prompts, no answers
    promptState: {}, // internal: crash-prompt bookkeeping {recent, last, never, pending}
    logs: [],
    tabJobs: {}, // internal: { [tabId]: job being looked at / applied to in that tab }
  };
  const INTERNAL = new Set(['logs', 'tabJobs', 'promptState', 'aiCalls']); // never exported or imported

  const area = () => AJP.api.storage.local;
  const cache = new Map();
  // Bumped on every change, so a read that started before a write never caches the stale value.
  const versions = new Map();
  const bump = (k) => versions.set(k, (versions.get(k) || 0) + 1);

  function withDefaults(key, value) {
    const def = DEFAULTS[key];
    if (value === undefined) return AJP.clone(def);
    if (AJP.isPlainObject(def) && AJP.isPlainObject(value)) return AJP.deepMerge(def, value);
    return value;
  }

  try {
    AJP.api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      for (const k of Object.keys(changes)) {
        cache.delete(k);
        bump(k);
      }
    });
  } catch (_) {
    /* no extension storage API (e.g. the command-line test runner): the cache simply isn't invalidated */
  }

  AJP.store = {
    DEFAULTS,
    KEYS: Object.keys(DEFAULTS),

    async get(key) {
      if (cache.has(key)) return AJP.clone(cache.get(key));
      const ver = versions.get(key) || 0;
      const r = await area().get(key);
      const v = withDefaults(key, r[key]);
      if (!INTERNAL.has(key) && (versions.get(key) || 0) === ver) cache.set(key, v);
      return AJP.clone(v);
    },

    async getMany(keys) {
      const out = {};
      await Promise.all(keys.map(async (k) => (out[k] = await this.get(k))));
      return out;
    },

    async set(key, value) {
      cache.delete(key);
      bump(key);
      try {
        // A write can fail briefly (e.g. the browser is busy); retry once before reporting AJP-STORE.
        await (AJP.retry ? AJP.retry(() => area().set({ [key]: value }), { tries: 2, baseMs: 150, retryOn: () => true, label: 'storage write' }) : area().set({ [key]: value }));
      } catch (e) {
        // Usually quota exceeded or storage blocked. Log (except for logs themselves) and surface a coded error.
        if (key !== 'logs' && AJP.logger) AJP.logger('storage').error('Write failed', { key, error: e.message }, { code: 'AJP-STORE' });
        throw AJP.err ? AJP.err('STORAGE', { key, original: e.message }, e) : e;
      }
    },

    // Read-modify-write. fn may mutate and/or return the new value.
    async update(key, fn) {
      const cur = await this.get(key);
      const ret = await fn(cur);
      const next = ret === undefined ? cur : ret;
      await this.set(key, next);
      return next;
    },

    async activeResume() {
      const r = await this.get('resumes');
      return r.items.find((x) => x.id === r.activeId) || r.items[0] || null;
    },

    async exportAll({ includeKeys = false, includeLogs = false } = {}) {
      const data = await this.getMany(this.KEYS.filter((k) => (includeLogs && k === 'logs') || !INTERNAL.has(k)));
      if (!includeKeys && data.settings) data.settings.ai.keys = Object.fromEntries(Object.keys(data.settings.ai.keys || {}).map((k) => [k, '']));
      return { app: 'apply-job-plugin', version: AJP.VERSION, exportedAt: new Date().toISOString(), data };
    },

    async importAll(backup) {
      if (!backup || backup.app !== 'apply-job-plugin' || !backup.data) throw AJP.err('BACKUP_INVALID');
      const toSet = {};
      for (const k of this.KEYS) if (k in backup.data && !INTERNAL.has(k)) toSet[k] = backup.data[k];
      cache.clear();
      for (const k of Object.keys(toSet)) bump(k);
      await area().set(toSet);
      return Object.keys(toSet);
    },

    async wipe() {
      cache.clear();
      for (const k of this.KEYS) bump(k);
      await area().clear();
    },
  };
})();
