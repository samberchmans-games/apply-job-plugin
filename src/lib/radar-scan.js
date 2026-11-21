/*
 * Job Radar scan engine (docs/JOB-FINDER.md §8). Two stages: a cheap list stage for every due company, then detail
 * calls only for jobs that pass the quick filter. Takes `fetch` as a parameter (tests pass a fake). Saves after each
 * company, so a worker stopped mid-scan resumes on the next run. AJP.radar.scan
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.radar = AJP.radar || {};
  if (AJP.radar.scan) return;
  const log = AJP.logger('radar');

  // §8.1 budgets (tests shorten the waits)
  const CONFIG = {
    concurrency: 3,
    hostGapMs: 1000,
    timeoutMs: 15000,
    maxPages: 5,
    maxKeywords: 3,
    detailPerCompany: 25,
    requestsPerScan: 400,
    minIntervalHours: 1,
    lockStaleMs: 2 * 60 * 1000, // a running scan refreshes its lock after every company (heartbeat)
    maxScanMs: 4 * 60 * 1000, // Chrome stops a background task after ~5 min: end in time, resume on the next run
    retryWaitMaxMs: 60000,
    pauseAfterFailures: 5,
    backfillPerScan: 20, // title-only jobs (detail budget used earlier) get their description and a real score later
    // Built-in directory (radar-directory.js): scanned in rotation so every company is covered about once a day.
    directoryMinPerScan: 30,
    directoryFailSkip: 3, // a directory company failing 3 scans in a row is skipped until the next refresh
    bytesPerScan: 50 * 1024 * 1024, // download budget per scan (directory slice stops when it is used)
  };
  const serial = AJP.serial();
  // Stop: the running scan finishes the request in flight, then ends (its queue is dropped, nothing resumes).
  let cancelRequested = false;
  let active = false; // a scan is running in THIS background instance (a lock left by a stopped worker is not)
  const cancel = () => (cancelRequested = true);
  const isActive = () => active;
  // A lock nobody holds any more (the worker was stopped mid-scan): clear it so the page stops saying "Scanning now".
  async function clearStaleLock() {
    if (active) return false;
    await serial(() => AJP.store.update('radarScanState', (s) => void (s.lockedAt = null)));
    return true;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- HTTP: timeout, JSON / text, status → RADAR_* codes, one retry on 429 / 5xx -------------------
  function statusError(status, ctx, retryAfter) {
    if (status === 404 || status === 410 || status === 400 || status === 403) return AJP.err('RADAR_BOARD_NOT_FOUND', { ...ctx, status });
    if (status === 429) return AJP.err('RADAR_RATE_LIMIT', { ...ctx, status, retryAfter });
    if (status >= 500) return AJP.err('RADAR_SERVER', { ...ctx, status, retryAfter });
    return AJP.err('RADAR_BAD_RESPONSE', { ...ctx, status });
  }
  async function httpOnce(req, { fetchImpl, responseType, ctx, counter }) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.timeoutMs);
    let res;
    try {
      res = await fetchImpl(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body, signal: ctl.signal });
    } catch (e) {
      throw AJP.err(e && e.name === 'AbortError' ? 'RADAR_TIMEOUT' : 'RADAR_NETWORK', { ...ctx, original: e && e.message }, e);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '', 10);
      throw statusError(res.status, ctx, isNaN(ra) ? undefined : ra);
    }
    const text = await res.text();
    if (counter) counter.bytes += text.length;
    if (responseType === 'text') return text;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw AJP.err('RADAR_BAD_RESPONSE', { ...ctx, reason: 'not JSON' }, e);
    }
  }
  async function request(req, opts) {
    try {
      return await httpOnce(req, opts);
    } catch (e) {
      const x = AJP.toAppError(e);
      if (!['AJP-RADAR-429', 'AJP-RADAR-5XX'].includes(x.code)) throw x;
      const wait = Math.min(((x.details && x.details.retryAfter) || 2) * 1000, CONFIG.retryWaitMaxMs);
      await sleep(wait);
      return httpOnce(req, opts);
    }
  }

  // ---- One company ------------------------------------------------------------------------------------
  function makeCounter() {
    const lastAt = {};
    return {
      used: 0,
      bytes: 0,
      async gate(url) {
        if (cancelRequested) throw Object.assign(new Error('scan stopped'), { budget: true, cancelled: true });
        if (this.used >= CONFIG.requestsPerScan) throw Object.assign(new Error('scan budget used'), { budget: true });
        this.used++;
        let host = '';
        try {
          host = new URL(url).hostname;
        } catch (_) {
          host = ''; // relative URL in a test: no per-host pause
        }
        const wait = (lastAt[host] || 0) + CONFIG.hostGapMs - Date.now();
        lastAt[host] = Date.now() + Math.max(0, wait);
        if (wait > 0) await sleep(wait);
      },
    };
  }

  // A job with no description is not scored: skills named in a title alone ("Machine Learning") would read as 100%.
  function bestScore(job, profile, resumes) {
    if (job.descriptionLevel === 'title') {
      const tracks = AJP.tracks.list(profile);
      const fit = tracks.find((t) => AJP.radar.core.titleFits(job.title, t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || []));
      return { score: null, bestTrackId: (fit || tracks[0] || {}).id || null };
    }
    const r = AJP.tracks.analyzeAll({ jdText: job.description || job.title, jobTitle: job.title, jobLocation: job.locations.join('; '), profile, resumes });
    const best = r.results.find((x) => x.track.id === r.bestId) || r.results[0];
    const a = best && best.analysis;
    // Same numbers as the job page's panel: score, and "N of M skills match".
    return { score: a && a.score != null ? a.score : null, bestTrackId: r.bestId, skillsMatched: a ? a.matched.length : 0, skillsTotal: a ? a.jdSkillCount : 0 };
  }

  async function scanCompany(entry, { fetchImpl, counter, settings, profile, resumes, seen, now }) {
    const C = AJP.radar.core;
    const adapter = AJP.radar.boards.get(entry.board);
    if (!adapter) throw AJP.err('RADAR_UNSUPPORTED', { board: entry.board });
    // Workday searches by keyword: one title per career track first (up to 3 tracks), then more titles.
    const titleLists = AJP.tracks.list(profile).map((t) => (t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || []));
    const keywords = [];
    for (let i = 0; keywords.length < CONFIG.maxKeywords && i < 10; i++) for (const l of titleLists) if (l[i] && !keywords.includes(l[i]) && keywords.length < CONFIG.maxKeywords) keywords.push(l[i]);
    const ctx = { keywords, now };
    let e = { ...entry };
    const reqCtx = { board: e.board, company: e.company };
    const opts = { fetchImpl, responseType: adapter.responseType, ctx: reqCtx, counter };

    // List stage
    const partials = [];
    let total = 0;
    const starts = adapter.listRequests ? adapter.listRequests(e, ctx) : [adapter.listRequest(e, ctx)];
    for (let s = 0; s < starts.length; s++) {
      let req = starts[s];
      for (let page = 0; req && page < CONFIG.maxPages; page++) {
        let body;
        try {
          await counter.gate(req.url);
          body = await request(req, opts);
        } catch (err) {
          // Lever EU / Personio .com: a 404 on the first page → the board's other host, once; remembered in the entry
          const x = AJP.toAppError(err);
          const alt = x.code === 'AJP-RADAR-404' && page === 0 && s === 0 && adapter.onNotFound && adapter.onNotFound(e);
          if (!alt) throw err;
          e = alt;
          req = (adapter.listRequests ? adapter.listRequests(e, ctx) : [adapter.listRequest(e, ctx)])[0];
          await counter.gate(req.url);
          body = await request(req, opts);
        }
        const out = adapter.parseList(body, e, ctx, req);
        if (page === 0 && s === 0) total = out.total != null ? out.total : out.jobs.length;
        partials.push(...out.jobs);
        req = out.next;
      }
    }
    if (starts.length > 1) total = new Set(partials.map((p) => String(p.id))).size;

    // Normalize, skip seen, quick filter
    const foundAt = new Date(now).toISOString();
    const byKey = new Map();
    for (const p of partials) {
      const j = C.normalize({ ...p, foundAt }, e);
      if (j.title && !byKey.has(j.key)) byKey.set(j.key, { j, p });
    }
    const listedKeys = [...byKey.keys()];
    const fresh = [...byKey.values()].filter(({ j }) => !seen[j.key]);
    const passing = fresh.filter((item) => {
      const f = C.quickFilter(item.j, settings, profile);
      item.trackId = f.trackId;
      return f.pass;
    });

    // Detail stage (boards whose list has no description): best title fit first, up to the budget
    let details = 0;
    if (adapter.detailRequest) {
      const tracks = AJP.tracks.list(profile);
      const fit = (j) => Math.max(0, ...tracks.map((t) => AJP.tracks.titleFit(j.title, { targetTitles: (t.targetTitles || []).length ? t.targetTitles : profile.targetRoles || [] })));
      passing.sort((a, b) => fit(b.j) - fit(a.j));
      for (const item of passing) {
        if (item.j.descriptionLevel === 'full' || details >= CONFIG.detailPerCompany) continue;
        const req = adapter.detailRequest(item.p, e);
        if (!req) continue;
        try {
          await counter.gate(req.url);
          const body = await request(req, { ...opts, responseType: adapter.detailType || adapter.responseType });
          details++;
          item.j = C.normalize({ ...item.p, ...adapter.parseDetail(body, item.p, e), foundAt }, e);
        } catch (err) {
          if (err && err.budget) break;
          log.warn('Job detail could not be read; scored on its title', { board: e.board, company: e.company, code: AJP.toAppError(err).code });
        }
      }
    }

    // Score
    const jobs = passing.map(({ j }) => ({ ...j, ...bestScore(j, profile, resumes), eligibility: C.eligibility(j.description, profile) }));
    return { entry: e, total, listedKeys, jobs, details };
  }

  // ---- Saving -----------------------------------------------------------------------------------------
  async function saveCompany(result, now) {
    await serial(async () => {
      const C = AJP.radar.core;
      if (result.jobs.length) {
        await AJP.store.update('radarJobs', (list) => {
          const have = new Set(list.map((j) => j.key));
          return [...result.jobs.filter((j) => !have.has(j.key)), ...list];
        });
      }
      if (result.listedKeys.length) await AJP.store.update('radarSeen', (seen) => C.markSeen(seen, result.listedKeys, now));
      await AJP.store.update('radarWatchlist', (list) =>
        list.map((w) => (w.key === result.key ? {
          ...w,
          ...(result.entry ? { region: result.entry.region, domain: result.entry.domain } : {}),
          ...(result.companyName ? { companyName: result.companyName } : {}),
          lastScanAt: new Date(now).toISOString(),
          ...(result.error
            ? { lastError: { code: result.error, at: new Date(now).toISOString() }, failuresInRow: (w.failuresInRow || 0) + 1, paused: w.paused || (w.failuresInRow || 0) + 1 >= CONFIG.pauseAfterFailures }
            : { lastError: null, failuresInRow: 0, openJobs: result.total }),
        } : w))
      );
      await AJP.store.update('radarScanState', (st) => void (st.done = [...new Set([...(st.done || []), result.key])]));
    });
  }

  /*
   * run({ fetchImpl, now, onlyKey, force }) → summary { companies, requests, listed, new, matches[], errors[], ms, resumed }
   * Throws RADAR_BUSY when another scan holds the lock (a lock older than 10 minutes is taken over).
   */
  // The directory slice for this scan: companies not in your watchlist, not hidden, on boards you allowed, not failing;
  // next in rotation (cursor), sized so the whole directory is covered about once a day.
  function directorySlice({ settings, watchlist, state, allowedBoards, interval }) {
    const dir = AJP.radar.directory || [];
    if (!dir.length || settings.directory === false) return [];
    const mine = new Set(watchlist.map((w) => w.key));
    const hidden = new Set(settings.excluded || []);
    const fails = state.dirFail || {};
    const all = dir
      .map(([board, company, name]) => ({ key: AJP.radar.detect.keyOf({ board, company }), board, company, companyName: name, directory: true }))
      .filter((e) => !mine.has(e.key) && !hidden.has(e.key) && (fails[e.key] || 0) < CONFIG.directoryFailSkip && (!allowedBoards || allowedBoards.has(e.board)) && AJP.radar.boards.get(e.board));
    if (!all.length) return [];
    const size = Math.min(all.length, Math.max(CONFIG.directoryMinPerScan, Math.ceil((all.length * interval) / (24 * 3600000))));
    const start = (state.dirCursor || 0) % all.length;
    return Array.from({ length: size }, (_, i) => all[(start + i) % all.length]);
  }

  async function run({ fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now(), onlyKey = null, force = false, allowedBoards = null } = {}) {
    const t0 = Date.now();
    const got = await serial(async () => {
      const st = await AJP.store.get('radarScanState');
      if (st.lockedAt && now - st.lockedAt < CONFIG.lockStaleMs) return false;
      await AJP.store.update('radarScanState', (s) => void (s.lockedAt = now));
      return true;
    });
    if (!got) throw AJP.err('RADAR_BUSY');
    cancelRequested = false;
    active = true;
    const summary = { companies: 0, requests: 0, listed: 0, new: 0, matches: [], errors: [], ms: 0, resumed: false };
    try {
      const [settings, watchlist, profile, resumes, state] = await Promise.all(['radarSettings', 'radarWatchlist', 'profile', 'resumes', 'radarScanState'].map((k) => AJP.store.get(k)));
      const interval = Math.max(CONFIG.minIntervalHours, Number(settings.intervalHours) || 3) * 3600000;
      const remaining = (state.queue || []).filter((k) => !(state.done || []).includes(k));
      let queue;
      if (!onlyKey && remaining.length) {
        queue = remaining; // a scan was stopped: carry on where it left off
        summary.resumed = true;
      } else {
        queue = watchlist
          .filter((w) => (onlyKey ? w.key === onlyKey : !w.paused && (force || !w.lastScanAt || now - Date.parse(w.lastScanAt) >= interval)))
          .sort((a, b) => String(a.lastScanAt || '').localeCompare(String(b.lastScanAt || '')))
          .map((w) => w.key);
        await AJP.store.update('radarScanState', (s) => void Object.assign(s, { queue, done: [] }));
      }
      const byKey = Object.fromEntries(watchlist.map((w) => [w.key, w]));
      // Directory: one slice per interval (or per "Scan now"), after your own companies.
      const dirDue = !onlyKey && (force || !state.dirAt || now - state.dirAt >= interval);
      const slice = dirDue ? directorySlice({ settings, watchlist, state, allowedBoards, interval }) : [];
      for (const e of slice) {
        byKey[e.key] = e;
        queue.push(e.key);
      }
      const dirOutcome = {};
      let dirDone = 0;
      const seen = await AJP.store.get('radarSeen');
      const counter = makeCounter();
      let next = 0;
      let stopped = false;
      const worker = async () => {
        while (!stopped && next < queue.length) {
          if (cancelRequested) {
            stopped = true;
            break;
          }
          if (Date.now() - t0 > CONFIG.maxScanMs) {
            stopped = true; // time is up: the rest of the queue (and the directory slice) continues next run
            summary.timeUp = true;
            break;
          }
          const key = queue[next++];
          const entry = byKey[key];
          if (!entry) continue;
          let result;
          try {
            if (entry.directory && counter.bytes > CONFIG.bytesPerScan) continue; // download budget used: the rest next time
            const r = await scanCompany(entry, { fetchImpl, counter, settings, profile, resumes, seen, now });
            if (entry.directory) dirOutcome[key] = 0;
            result = { key, ...r, companyName: (r.jobs[0] && r.jobs[0].companyName !== r.entry.company && r.jobs[0].companyName) || null };
            summary.listed += r.total;
            summary.new += r.jobs.length;
            summary.matches.push(...r.jobs.filter((j) => j.score != null && j.score >= (Number(settings.threshold) || 60) && !(j.eligibility && j.eligibility.status === 'blocked')).map((j) => ({ key: j.key, title: j.title, companyName: j.companyName, score: j.score })));
          } catch (err) {
            if (err && err.budget) {
              stopped = true; // the rest wait for the next scan (the queue keeps them)
              break;
            }
            const x = AJP.toAppError(err);
            result = { key, error: x.code, listedKeys: [], jobs: [] };
            if (entry.directory) {
              dirOutcome[key] = 1; // directory failures are quiet: counted, then skipped after a few
              summary.directoryErrors = (summary.directoryErrors || 0) + 1;
              await saveCompany(result, now);
              summary.companies++;
              dirDone++;
              continue;
            }
            summary.errors.push({ key, code: x.code });
            log.warn('Company scan failed', { board: entry.board, company: entry.company, code: x.code, status: x.details && x.details.status });
          }
          summary.companies++;
          if (entry.directory) dirDone++;
          await saveCompany(result, now);
          await serial(() => AJP.store.update('radarScanState', (s) => void (s.lockedAt = Date.now()))); // heartbeat
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency, queue.length) }, worker));
      if (!stopped && !cancelRequested) {
        try {
          summary.backfilled = await backfill({ fetchImpl, counter, now });
        } catch (e) {
          log.warn('Description backfill failed', { error: e.message });
        }
      }
      summary.requests = counter.used;
      summary.bytes = counter.bytes;
      summary.directory = slice.length;
      summary.stopped = stopped;
      summary.cancelled = cancelRequested;
      if (slice.length) {
        await AJP.store.update('radarScanState', (s) => {
          s.dirAt = now;
          s.dirCursor = ((s.dirCursor || 0) + (summary.timeUp || cancelRequested ? dirDone : slice.length)) % Math.max(1, (AJP.radar.directory || []).length);
          const f = { ...(s.dirFail || {}) };
          for (const [k, bad] of Object.entries(dirOutcome)) bad ? (f[k] = (f[k] || 0) + 1) : delete f[k];
          s.dirFail = f;
        });
      }
      if (!stopped || cancelRequested) await AJP.store.update('radarScanState', (s) => void Object.assign(s, { queue: [], done: [] }));
      else if (stopped) await AJP.store.update('radarScanState', (s) => void (s.queue = (s.queue || []).filter((k) => watchlist.some((w) => w.key === k))));
      await serial(async () => {
        const [jobs, seenNow] = await Promise.all([AJP.store.get('radarJobs'), AJP.store.get('radarSeen')]);
        const p = AJP.radar.core.prune({ jobs, seen: seenNow }, now);
        await AJP.store.set('radarJobs', p.jobs);
        await AJP.store.set('radarSeen', p.seen);
      });
      summary.ms = Date.now() - t0;
      // One summary line per scan (never job descriptions).
      log.info('Radar scan done', { companies: summary.companies, requests: summary.requests, listed: summary.listed, new: summary.new, matches: summary.matches.length, errors: summary.errors.length, ms: summary.ms, resumed: summary.resumed });
      return summary;
    } finally {
      active = false;
      await serial(() => AJP.store.update('radarScanState', (s) => void Object.assign(s, { lockedAt: null, lastSummary: { ...summary, matches: summary.matches.length, at: new Date(now).toISOString() } })));
    }
  }

  // Title-only jobs already listed (their company had more matches than the detail budget, or a detail call failed):
  // fetch their descriptions now, a few per scan, and score them like the job page.
  async function backfill({ fetchImpl, counter, now }) {
    const C = AJP.radar.core;
    const [profile, resumes, list] = await Promise.all([AJP.store.get('profile'), AJP.store.get('resumes'), AJP.store.get('radarJobs')]);
    const todo = list.filter((j) => j.status === 'new' && j.descriptionLevel === 'title' && AJP.radar.boards.get(j.board) && AJP.radar.boards.get(j.board).detailRequest).slice(0, CONFIG.backfillPerScan);
    const done = {};
    for (const j of todo) {
      const adapter = AJP.radar.boards.get(j.board);
      const entry = { board: j.board, company: j.company, companyName: j.companyName, ...(j.entry || {}) };
      const id = j.key.split(':').slice(2).join(':');
      const req = adapter.detailRequest({ ...j, id }, entry);
      if (!req) continue;
      try {
        await counter.gate(req.url);
        const body = await request(req, { fetchImpl, responseType: adapter.detailType || adapter.responseType, ctx: { board: j.board, company: j.company }, counter });
        const d = adapter.parseDetail(body, { ...j, id }, entry);
        const merged = C.normalize({ ...j, id, ...d, raw: { workplaceType: j.remote }, postedAt: d.postedAt || j.postedAt, foundAt: j.foundAt }, entry);
        if (merged.descriptionLevel !== 'full') continue;
        done[j.key] = { ...merged, key: j.key, status: j.status, notifiedAt: j.notifiedAt, ...bestScore(merged, profile, resumes), eligibility: C.eligibility(merged.description, profile) };
      } catch (err) {
        if (err && err.budget) break;
        log.debug('Description could not be fetched yet', { board: j.board, code: AJP.toAppError(err).code });
      }
    }
    if (Object.keys(done).length) await serial(() => AJP.store.update('radarJobs', (l) => l.map((j) => done[j.key] || j)));
    return Object.keys(done).length;
  }

  // Check one board before saving it to the watchlist: fetch the list once → company name + open jobs.
  async function probe(entry, { fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    const adapter = AJP.radar.boards.get(entry.board);
    if (!adapter) throw AJP.err('RADAR_UNSUPPORTED', { board: entry.board });
    const opts = { fetchImpl, responseType: adapter.responseType, ctx: { board: entry.board, company: entry.company } };
    const ctx = { keywords: [], now: Date.now() };
    let e = { ...entry };
    let body;
    const first = (x) => (adapter.listRequests ? adapter.listRequests(x, ctx) : [adapter.listRequest(x, ctx)])[0];
    let req = first(e);
    try {
      body = await request(req, opts);
    } catch (err) {
      const alt = AJP.toAppError(err).code === 'AJP-RADAR-404' && adapter.onNotFound && adapter.onNotFound(e);
      if (!alt) throw err;
      e = alt;
      req = first(e);
      body = await request(req, opts);
    }
    const out = adapter.parseList(body, e, ctx, req);
    const named = out.jobs.find((j) => j.companyName);
    return { entry: e, openJobs: out.total != null ? out.total : out.jobs.length, companyName: (named && named.companyName) || out.companyName || null };
  }

  AJP.radar.scan = { CONFIG, run, probe, request, cancel, isActive, clearStaleLock };
})();
