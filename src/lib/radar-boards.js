/*
 * Job Radar board adapters (docs/JOB-FINDER.md §6). Pure functions: build requests, parse responses. No network,
 * no storage, never throw on a missing field (radar-core.normalize fills defaults). A response that is not the
 * expected shape throws RADAR_BAD_RESPONSE. AJP.radar.boards
 *
 *   register({ id, label, wave, hosts, responseType, listRequest(entry, ctx), parseList(body, entry, ctx),
 *              detailRequest?(job, entry), parseDetail?(body, job), onNotFound?(entry) → entry | null })
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.radar = AJP.radar || {};
  if (AJP.radar.boards) return;
  const C = () => AJP.radar.core;

  const registry = {};
  function register(a) {
    registry[a.id] = { responseType: 'json', ...a };
  }
  const get = (id) => registry[id] || null;
  const all = () => Object.values(registry);
  const bad = (board, reason) => AJP.err('RADAR_BAD_RESPONSE', { board, reason });
  const enc = encodeURIComponent;

  // ---- Wave A ---------------------------------------------------------------------------------------
  register({
    id: 'greenhouse',
    label: 'Greenhouse',
    wave: 'A',
    hosts: ['https://boards-api.greenhouse.io/*'],
    listRequest: (e) => ({ url: `https://boards-api.greenhouse.io/v1/boards/${enc(e.company)}/jobs?content=true`, method: 'GET' }),
    parseList(body, e) {
      if (!body || !Array.isArray(body.jobs)) throw bad('greenhouse', 'no jobs array');
      return {
        total: body.jobs.length,
        next: null,
        jobs: body.jobs.map((j) => ({
          id: j.id,
          title: j.title,
          companyName: j.company_name,
          locations: [j.location && j.location.name, ...((j.offices || []).map((o) => o && o.name))],
          url: j.absolute_url,
          postedAt: j.first_published || j.updated_at,
          department: (j.departments || [])[0] && j.departments[0].name,
          description: C().htmlToText(j.content), // double-encoded HTML: htmlToText decodes it first
          raw: {},
        })).map((j) => ({ ...j, locations: j.locations.filter(Boolean) })),
      };
    },
  });

  register({
    id: 'lever',
    label: 'Lever',
    wave: 'A',
    hosts: ['https://api.lever.co/*', 'https://api.eu.lever.co/*'],
    listRequest: (e) => ({ url: `https://api${e.region === 'eu' ? '.eu' : ''}.lever.co/v0/postings/${enc(e.company)}?mode=json`, method: 'GET' }),
    onNotFound: (e) => (e.region === 'eu' ? null : { ...e, region: 'eu' }), // EU accounts live on api.eu.lever.co
    parseList(body) {
      if (!Array.isArray(body)) throw bad('lever', 'not an array');
      return {
        total: body.length,
        next: null,
        jobs: body.map((j) => {
          const cat = j.categories || {};
          const sr = j.salaryRange;
          return {
            id: j.id,
            title: j.text,
            locations: [cat.location, ...(cat.allLocations || [])],
            url: j.hostedUrl,
            postedAt: j.createdAt,
            department: cat.team || cat.department,
            employmentType: cat.commitment,
            salary: sr && (sr.min || sr.max) ? { min: sr.min, max: sr.max, currency: sr.currency || 'USD', period: /hour/i.test(sr.interval) ? 'hour' : /month/i.test(sr.interval) ? 'month' : 'year', source: 'field' } : null,
            description: [j.descriptionPlain || C().htmlToText(j.description), ...((j.lists || []).map((l) => `${l.text}\n${C().htmlToText(l.content)}`)), j.additionalPlain || C().htmlToText(j.additional)].filter(Boolean).join('\n\n'),
            raw: { workplaceType: j.workplaceType },
          };
        }),
      };
    },
  });

  register({
    id: 'ashby',
    label: 'Ashby',
    wave: 'A',
    hosts: ['https://api.ashbyhq.com/*'],
    listRequest: (e) => ({ url: `https://api.ashbyhq.com/posting-api/job-board/${enc(e.company)}?includeCompensation=true`, method: 'GET' }),
    parseList(body) {
      if (!body || !Array.isArray(body.jobs)) throw bad('ashby', 'no jobs array');
      const listed = body.jobs.filter((j) => j.isListed !== false);
      return {
        total: listed.length,
        next: null,
        jobs: listed.map((j) => {
          const sal = ((j.compensation && j.compensation.summaryComponents) || []).find((c) => c.compensationType === 'Salary' && (c.minValue || c.maxValue));
          return {
            id: j.id,
            title: j.title,
            locations: [j.location, ...((j.secondaryLocations || []).map((l) => (typeof l === 'string' ? l : l && l.location)))],
            url: j.jobUrl,
            postedAt: j.publishedAt,
            department: j.department,
            employmentType: j.employmentType,
            salary: sal ? { min: sal.minValue, max: sal.maxValue, currency: sal.currencyCode || 'USD', period: /hour/i.test(sal.interval) ? 'hour' : /month/i.test(sal.interval) ? 'month' : 'year', source: 'field' } : null,
            description: j.descriptionPlain || C().htmlToText(j.descriptionHtml),
            raw: { workplaceType: j.workplaceType, isRemote: j.workplaceType ? undefined : j.isRemote },
          };
        }),
      };
    },
  });

  // Host permissions an entry needs (optional_host_permissions). Teamtailor on a custom domain also needs that domain.
  function hostsFor(entry) {
    const a = registry[entry && entry.board];
    const hosts = a ? [...a.hosts] : [];
    if (entry.board === 'teamtailor' && entry.domain && !/\.teamtailor\.com$/.test(entry.domain)) hosts.push(`https://${entry.domain}/*`);
    return hosts;
  }

  AJP.radar.boards = { register, get, all, hostsFor };
})();
