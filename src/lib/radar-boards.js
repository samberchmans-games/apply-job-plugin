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
    // Light list (no descriptions: a big board is ~100x smaller); descriptions come from the detail call, only for the
    // jobs that pass the quick filter. A list that already has `content` (older captures) is used as is.
    listRequest: (e) => ({ url: `https://boards-api.greenhouse.io/v1/boards/${enc(e.company)}/jobs?content=false`, method: 'GET' }),
    detailRequest: (job, e) => ({ url: `https://boards-api.greenhouse.io/v1/boards/${enc(e.company)}/jobs/${enc(job.id)}`, method: 'GET' }),
    parseDetail: (body) => ({ description: C().htmlToText(body && body.content) }),
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
          description: j.content ? C().htmlToText(j.content) : '', // double-encoded HTML: htmlToText decodes it first
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

  // ---- Wave B ---------------------------------------------------------------------------------------
  const per = (v) => (/hour/i.test(v) ? 'hour' : /month/i.test(v) ? 'month' : /week/i.test(v) ? 'week' : 'year');
  const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')) || null);

  register({
    id: 'workable',
    label: 'Workable',
    wave: 'B',
    hosts: ['https://apply.workable.com/*'],
    listRequest: (e) => ({ url: `https://apply.workable.com/api/v1/widget/accounts/${enc(e.company)}?details=true`, method: 'GET' }),
    parseList(body) {
      if (!body || !Array.isArray(body.jobs)) throw bad('workable', 'no jobs array');
      return {
        total: body.jobs.length,
        next: null,
        jobs: body.jobs.map((j) => ({
          id: j.shortcode || j.code,
          title: j.title,
          companyName: body.name,
          locations: (j.locations && j.locations.length ? j.locations.map((l) => [l.city, l.region, l.country].filter(Boolean).join(', ')) : [[j.city, j.state, j.country].filter(Boolean).join(', ')]),
          url: j.url || j.shortlink,
          postedAt: j.published_on || j.created_at,
          department: j.department,
          employmentType: j.employment_type,
          description: C().htmlToText(j.description),
          raw: { telecommuting: j.telecommuting === true },
        })),
      };
    },
  });

  register({
    id: 'recruitee',
    label: 'Recruitee',
    wave: 'B',
    hosts: ['https://*.recruitee.com/*'],
    listRequest: (e) => ({ url: `https://${enc(e.company)}.recruitee.com/api/offers/`, method: 'GET' }),
    parseList(body) {
      if (!body || !Array.isArray(body.offers)) throw bad('recruitee', 'no offers array');
      return {
        total: body.offers.length,
        next: null,
        jobs: body.offers.map((j) => {
          const s = j.salary || {};
          return {
            id: j.id,
            title: j.title,
            companyName: j.company_name,
            locations: [j.location || [j.city, j.country].filter(Boolean).join(', '), ...((j.locations || []).map((l) => [l.name, l.country].filter(Boolean).join(', ')))],
            url: j.careers_url,
            postedAt: j.published_at || j.created_at, // "YYYY-MM-DD HH:MM:SS UTC" (radar-core.parseDate)
            department: j.department,
            employmentType: j.employment_type_code,
            salary: num(s.min) || num(s.max) ? { min: num(s.min), max: num(s.max), currency: s.currency || 'EUR', period: per(s.period), source: 'field' } : null,
            description: [C().htmlToText(j.description), C().htmlToText(j.requirements)].filter(Boolean).join('\n\n'),
            raw: { remote: j.remote === true, hybrid: j.hybrid === true, on_site: j.on_site === true },
          };
        }),
      };
    },
  });

  register({
    id: 'breezy',
    label: 'Breezy HR',
    wave: 'B',
    hosts: ['https://*.breezy.hr/*'],
    listRequest: (e) => ({ url: `https://${enc(e.company)}.breezy.hr/json`, method: 'GET' }),
    parseList(body) {
      if (!Array.isArray(body)) throw bad('breezy', 'not an array');
      return {
        total: body.length,
        next: null,
        // No descriptions on Breezy: scored on the title (descriptionLevel 'title'); salary is free text.
        jobs: body.map((j) => ({
          id: j.id,
          title: j.name,
          locations: [j.location && j.location.name, ...((j.locations || []).map((l) => l && l.name))],
          url: j.url,
          postedAt: j.published_date,
          department: j.department,
          employmentType: j.type && j.type.name,
          salary: j.salary ? C().salaryFromText(String(j.salary).replace(/^\s*([$€£]?[\d,.]+k?)\s*\/\s*(\w+)/i, '$1 - $1 per $2')) : null,
          description: '',
          raw: { location: j.location || {} },
        })),
      };
    },
  });

  register({
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    wave: 'B',
    hosts: ['https://api.smartrecruiters.com/*'],
    listRequest: (e) => ({ url: `https://api.smartrecruiters.com/v1/companies/${enc(e.company)}/postings?limit=100&offset=0`, method: 'GET' }),
    parseList(body, e) {
      if (!body || !Array.isArray(body.content)) throw bad('smartrecruiters', 'no content array');
      const offset = (Number(body.offset) || 0) + body.content.length;
      return {
        total: Number(body.totalFound) || body.content.length,
        next: body.content.length && offset < Number(body.totalFound) ? { url: `https://api.smartrecruiters.com/v1/companies/${enc(e.company)}/postings?limit=100&offset=${offset}`, method: 'GET' } : null,
        jobs: body.content.map((j) => ({
          id: j.id,
          title: j.name,
          companyName: j.company && j.company.name,
          locations: [j.location && (j.location.fullLocation || [j.location.city, j.location.region, j.location.country].filter(Boolean).join(', '))],
          url: `https://jobs.smartrecruiters.com/${enc(e.company)}/${enc(j.id)}`,
          postedAt: j.releasedDate,
          department: j.department && j.department.label,
          employmentType: j.typeOfEmployment && j.typeOfEmployment.label,
          description: '',
          raw: { remote: !!(j.location && j.location.remote), hybrid: !!(j.location && j.location.hybrid) },
        })),
      };
    },
    detailRequest: (job, e) => ({ url: `https://api.smartrecruiters.com/v1/companies/${enc(e.company)}/postings/${enc(job.id)}`, method: 'GET' }),
    parseDetail(body) {
      const sec = (body && body.jobAd && body.jobAd.sections) || {};
      return { description: ['jobDescription', 'qualifications', 'additionalInformation'].map((k) => sec[k] && C().htmlToText(sec[k].text)).filter(Boolean).join('\n\n'), ...(body && body.postingUrl ? { url: body.postingUrl } : {}) };
    },
  });

  register({
    id: 'rippling',
    label: 'Rippling',
    wave: 'B',
    hosts: ['https://ats.rippling.com/*', 'https://api.rippling.com/*'],
    listRequest: (e) => ({ url: `https://ats.rippling.com/api/v2/board/${enc(e.company)}/jobs?page=0`, method: 'GET' }),
    parseList(body, e) {
      if (!body || !Array.isArray(body.items)) throw bad('rippling', 'no items array');
      // A job with several locations is listed once per location: merge them.
      const byId = new Map();
      for (const j of body.items) {
        const cur = byId.get(j.id) || { id: j.id, title: j.name, locations: [], url: j.url, department: j.department && (j.department.displayName || j.department.name), postedAt: null, description: '', raw: {} };
        for (const l of j.locations || []) {
          cur.locations.push(l.name);
          if (!cur.raw.workplaceType && l.workplaceType) cur.raw.workplaceType = l.workplaceType;
        }
        byId.set(j.id, cur);
      }
      const page = Number(body.page) || 0;
      return {
        total: Number(body.totalItems) || byId.size,
        next: page + 1 < Number(body.totalPages) ? { url: `https://ats.rippling.com/api/v2/board/${enc(e.company)}/jobs?page=${page + 1}`, method: 'GET' } : null,
        jobs: [...byId.values()],
      };
    },
    // The list has no date or description; the board's public job API has both (and the pay range).
    detailRequest: (job, e) => ({ url: `https://api.rippling.com/platform/api/ats/v1/board/${enc(e.company)}/jobs/${enc(job.id)}`, method: 'GET' }),
    parseDetail(body) {
      const d = body || {};
      const desc = d.description && typeof d.description === 'object' ? Object.values(d.description) : [d.description];
      const pay = (d.payRangeDetails || [])[0];
      return {
        description: desc.map((h) => C().htmlToText(h)).filter(Boolean).join('\n\n'),
        postedAt: d.createdOn || null,
        companyName: d.companyName,
        ...(Array.isArray(d.workLocations) && d.workLocations.length ? { locations: d.workLocations } : {}),
        employmentType: d.employmentType && (d.employmentType.id || d.employmentType.label),
        salary: pay && (pay.rangeStart || pay.rangeEnd) ? { min: pay.rangeStart, max: pay.rangeEnd, currency: pay.currency || 'USD', period: per(pay.frequency), source: 'field' } : null,
      };
    },
  });

  // ---- Wave C ---------------------------------------------------------------------------------------
  register({
    id: 'personio',
    label: 'Personio',
    wave: 'C',
    hosts: ['https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*'],
    responseType: 'text',
    listRequest: (e) => ({ url: `https://${enc(e.company)}.jobs.personio.${e.domain === 'com' ? 'com' : 'de'}/xml?language=en`, method: 'GET' }),
    onNotFound: (e) => (e.domain === 'com' ? null : { ...e, domain: 'com' }), // .de first, then .com (remembered)
    parseList(text, e) {
      const s = String(text || '');
      if (!/<workzag-jobs|<position>/.test(s)) throw bad('personio', 'not the jobs XML');
      const X = C();
      const items = X.xmlItems(s, 'position');
      return {
        total: items.length,
        next: null,
        jobs: items.map((it) => {
          const head = it.replace(/<jobDescriptions>[\s\S]*?<\/jobDescriptions>/g, ''); // description sections have <name> tags too
          const id = X.xmlValue(head, 'id');
          return {
            id,
            title: X.xmlValue(head, 'name'),
            locations: [X.xmlValue(head, 'office'), ...X.xmlValues(head, 'additionalOffices/office')],
            url: `https://${e.company}.jobs.personio.${e.domain === 'com' ? 'com' : 'de'}/job/${id}`,
            postedAt: X.xmlValue(it, 'createdAt'),
            department: X.xmlValue(it, 'department'),
            employmentType: [X.xmlValue(it, 'employmentType'), X.xmlValue(it, 'schedule')].filter(Boolean).join(', '),
            description: X.xmlItems(it, 'jobDescription').map((d) => `${X.xmlValue(d, 'name')}\n${X.htmlToText(X.xmlValue(d, 'value'))}`).join('\n\n'),
            raw: {},
          };
        }),
      };
    },
  });

  register({
    id: 'teamtailor',
    label: 'Teamtailor',
    wave: 'C',
    hosts: ['https://*.teamtailor.com/*'],
    responseType: 'text',
    // Custom careers domains are common: the entry keeps the domain the RSS lives on.
    listRequest: (e) => ({ url: `https://${e.domain || `${enc(e.company)}.teamtailor.com`}/jobs.rss`, method: 'GET' }),
    parseList(text) {
      const s = String(text || '');
      if (!/<rss[\s>]/.test(s)) throw bad('teamtailor', 'not RSS');
      const X = C();
      const items = X.xmlItems(s, 'item');
      return {
        total: items.length,
        next: null,
        jobs: items.map((it) => ({
          id: X.xmlValue(it, 'guid') || X.xmlValue(it, 'link'),
          title: X.xmlValue(it, 'title'),
          locations: X.xmlValues(it, 'locations/location/name'),
          url: X.xmlValue(it, 'link'),
          postedAt: X.xmlValue(it, 'pubDate'),
          department: X.xmlValue(it, 'department'),
          description: X.htmlToText(X.xmlValue(it, 'description')),
          raw: { remoteStatus: X.xmlValue(it, 'remoteStatus') },
        })),
      };
    },
  });

  // Workday: POST search; one search per track keyword (max 3) instead of paging every job; text dates.
  const wdBase = (e) => `https://${e.company}.wd${e.wd || 1}.myworkdayjobs.com`;
  const wdSearch = (e, searchText, offset) => ({
    url: `${wdBase(e)}/wday/cxs/${enc(e.company)}/${enc(e.site)}/jobs`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ limit: 20, offset, searchText, appliedFacets: {} }),
  });
  register({
    id: 'workday',
    label: 'Workday',
    wave: 'C',
    hosts: ['https://*.myworkdayjobs.com/*'],
    listRequest: (e, ctx = {}) => wdSearch(e, ((ctx.keywords || [])[0]) || '', 0),
    listRequests: (e, ctx = {}) => {
      const kws = (ctx.keywords || []).filter(Boolean).slice(0, 3);
      return (kws.length ? kws : ['']).map((k) => wdSearch(e, k, 0));
    },
    parseList(body, e, ctx, req) {
      if (!body || !Array.isArray(body.jobPostings)) throw bad('workday', 'no jobPostings array');
      let sent = {};
      try {
        sent = JSON.parse((req && req.body) || '{}');
      } catch (_) {
        sent = {}; // not our request (tests): start at offset 0
      }
      const offset = (Number(sent.offset) || 0) + body.jobPostings.length;
      const total = Number(body.total) || 0; // reliable on the first page only
      return {
        total: sent.offset ? undefined : total,
        next: body.jobPostings.length && offset < total ? wdSearch(e, sent.searchText || '', offset) : null,
        jobs: body.jobPostings.map((j) => ({
          id: j.externalPath,
          title: j.title,
          locations: /^\d+ Locations?$/i.test(j.locationsText || '') ? [] : [j.locationsText],
          url: `${wdBase(e)}/${e.site}${j.externalPath}`,
          postedAt: j.postedOn, // "Posted 3 Days Ago" → approximate (postedAtExact false)
          description: '',
          raw: {},
        })),
      };
    },
    detailRequest: (job, e) => ({ url: `${wdBase(e)}/wday/cxs/${enc(e.company)}/${enc(e.site)}${job.id}`, method: 'GET', headers: { Accept: 'application/json' } }),
    parseDetail(body) {
      const j = (body && body.jobPostingInfo) || {};
      return {
        description: C().htmlToText(j.jobDescription),
        locations: [j.location, ...(j.additionalLocations || [])].filter(Boolean),
        ...(j.startDate ? { postedAt: j.startDate, postedAtExact: true } : {}),
        employmentType: j.timeType,
        ...(j.externalUrl ? { url: j.externalUrl } : {}),
        raw: { workplaceType: j.remoteType },
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
