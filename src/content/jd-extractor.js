/*
 * jd-extractor.js — find the job description on the current page.
 * Order: schema.org JobPosting JSON-LD -> known-site selectors -> heuristic.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.jd) return;
  const log = AJP.logger('jd');

  const SITES = [
    { name: 'linkedin', host: /linkedin\.com$/, jd: ['.jobs-description__content', '.jobs-box__html-content', '#job-details', '.description__text', '.show-more-less-html__markup'], title: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'], company: ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link'] },
    { name: 'indeed', host: /indeed\.[a-z.]+$/, jd: ['#jobDescriptionText'], title: ['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1'], company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name]'] },
    { name: 'greenhouse', host: /greenhouse\.io$/, jd: ['.job__description', '#content', '#app_body'], title: ['.app-title', '.job__title h1', 'h1'], company: ['.company-name'] },
    { name: 'lever', host: /lever\.co$/, jd: ['.posting-page .section-wrapper.page-full-width', '.content-wrapper .content'], title: ['.posting-headline h2'], company: ['.main-header-logo img@alt'] },
    { name: 'workday', host: /(myworkdayjobs|myworkdaysite|workday)\.com$/, jd: ['[data-automation-id="jobPostingDescription"]'], title: ['[data-automation-id="jobPostingHeader"]', 'h2'], company: [] },
    { name: 'glassdoor', host: /glassdoor\.[a-z.]+$/, jd: ['[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer', '.jobDescriptionContent'], title: ['[data-test="job-title"]', 'h1'], company: ['[data-test="employer-name"]', '[class*="EmployerProfile_employerName"]'] },
    { name: 'ziprecruiter', host: /ziprecruiter\.com$/, jd: ['.job_description', '[class*="job_description"]'], title: ['h1'], company: ['.hiring_company_text', '[class*="company_name"]'] },
    { name: 'ashby', host: /ashbyhq\.com$/, jd: ['[class*="_descriptionText"]', '.ashby-job-posting-right-pane'], title: ['h1'], company: [] },
    { name: 'smartrecruiters', host: /smartrecruiters\.com$/, jd: ['.job-sections', '[itemprop="description"]'], title: ['h1'], company: ['[itemprop="hiringOrganization"] [itemprop="name"]'] },
  ];

  // Scope for one extraction. Tests pass {root, host}; the page uses document/location.
  let D = typeof document !== 'undefined' ? document : null;
  let HOST = '';

  const KEYWORDS = /(responsibilit|requirement|qualification|experience|what you|about the role|skills|you will|preferred)/gi;

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(
      String(html).replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div|ul|ol)>/gi, '\n$&').replace(/<li[^>]*>/gi, '\n• '),
      'text/html'
    );
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function textOf(el) {
    return (el.innerText || el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function pick(selectors) {
    for (const s of selectors || []) {
      const [sel, attr] = s.split('@');
      const el = D.querySelector(sel);
      if (!el) continue;
      const v = attr ? el.getAttribute(attr) : textOf(el);
      if (v && v.trim()) return v.trim();
    }
    return '';
  }

  function fromJsonLd() {
    for (const s of D.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch (_) {
        continue;
      }
      const items = [].concat(data, data && data['@graph'] ? data['@graph'] : []);
      const jp = items.find((x) => x && [].concat(x['@type']).includes('JobPosting'));
      if (!jp || !jp.description) continue;
      const loc = [].concat(jp.jobLocation || [])[0];
      const addr = loc && (Array.isArray(loc.address) ? loc.address[0] : loc.address); // some sites give a list
      return {
        source: 'jsonld',
        title: jp.title || '',
        company: (jp.hiringOrganization && jp.hiringOrganization.name) || '',
        location: addr ? [addr.addressLocality, addr.addressRegion, addr.addressCountry && (addr.addressCountry.name || addr.addressCountry)].filter(Boolean).join(', ') : jp.jobLocationType || '',
        text: htmlToText(jp.description),
      };
    }
    return null;
  }

  function fromSite() {
    const site = SITES.find((s) => s.host.test(HOST));
    if (!site) return null;
    const text = pick(site.jd);
    if (!text || text.length < 200) return null;
    return { source: site.name, title: pick(site.title), company: pick(site.company), location: '', text };
  }

  function heuristic() {
    let best = null;
    let bestScore = 0;
    for (const el of D.querySelectorAll('main, article, section, div')) {
      // textContent first: it doesn't make the browser lay out the page (offsetParent / innerText do).
      const len = (el.textContent || '').length;
      if (len < 400 || len > 60000) continue;
      if (el.offsetParent === null && el !== document.body) continue;
      const t = el.innerText || '';
      if (t.length < 400 || t.length > 25000) continue;
      const kw = (t.match(KEYWORDS) || []).length;
      if (kw < 2) continue;
      // Prefer tight containers: keyword density with a gentle length bonus.
      const score = kw * 1000 / Math.sqrt(t.length) + Math.min(t.length, 6000) / 1000;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return null;
    const h1 = D.querySelector('h1');
    return { source: 'heuristic', title: h1 ? textOf(h1).slice(0, 150) : document.title, company: '', location: '', text: textOf(best) };
  }

  function extract(opts = {}) {
    D = opts.root || document;
    HOST = String(opts.host || location.hostname).replace(/^www\./, '');
    const t0 = performance.now();
    let r = null;
    // On SPA sites (LinkedIn) the selected job changes without reload, so site selectors go first there.
    const spa = /linkedin\.com$/.test(HOST);
    for (const fn of spa ? [fromSite, fromJsonLd, heuristic] : [fromJsonLd, fromSite, heuristic]) {
      try {
        r = fn();
      } catch (e) {
        log.warn(`extractor ${fn.name} threw`, { error: e.message });
      }
      if (r && r.text && r.text.length >= 200) break;
      r = null;
    }
    if (r) {
      r.title = r.title || (D.querySelector('h1') && textOf(D.querySelector('h1'))) || document.title;
      r.title = r.title.split('\n')[0].trim().slice(0, 200);
      r.company = (r.company || '').split('\n')[0].trim().slice(0, 120);
      r.url = opts.url || location.href;
    }
    log.info('JD extraction', { source: r && r.source, chars: r ? r.text.length : 0, ms: Math.round(performance.now() - t0), host: HOST });
    return r;
  }

  AJP.jd = { extract, htmlToText, isKnownJobSite: (host = location.hostname) => SITES.some((s) => s.host.test(String(host).replace(/^www\./, ''))), SITES };
})();
