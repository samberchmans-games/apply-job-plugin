(function () {
  const { describe, it, eq, ok, includes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const sandbox = () => document.getElementById('sandbox');
  const html = (s) => (sandbox().innerHTML = s);
  const extract = (host = 'example.com') => AJP.jd.extract({ root: sandbox(), host, url: 'https://' + host + '/job/1' });

  const LONG = 'We are looking for an engineer with strong experience. '.repeat(10); // real JDs are > 400 chars
  const JD_HTML = `<p>${LONG}</p><h3>Requirements</h3><ul><li>Python</li><li>Kubernetes</li></ul><h3>Nice to have</h3><ul><li>Kafka</li></ul>`;
  const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
  const POSTING = {
    '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Senior Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Acme' },
    jobLocation: { '@type': 'Place', address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } },
    description: JD_HTML,
  };

  describe('job page reading › htmlToText', () => {
    it('keeps list items and paragraphs on separate lines', () => {
      const t = AJP.jd.htmlToText('<p>Intro</p><ul><li>Python</li><li>Go</li></ul>');
      includes(t, '• Python');
      ok(t.split('\n').length >= 3);
    });
    it('turns <br> into newlines and decodes entities', () => eq(AJP.jd.htmlToText('A<br>B &amp; C'), 'A\nB & C'));
  }, { env: 'browser' });

  describe('job page reading › sources', () => {
    afterEach(() => html(''));

    it('reads schema.org JobPosting JSON-LD (title, company, location, text)', () => {
      html(jsonLd(POSTING));
      const r = extract();
      eq([r.source, r.title, r.company, r.location], ['jsonld', 'Senior Engineer', 'Acme', 'Austin, TX, US']);
      includes(r.text, 'Requirements');
      includes(r.text, '• Kubernetes');
      eq(r.url, 'https://example.com/job/1');
    });
    it('finds JobPosting inside @graph and with @type arrays', () => {
      html(jsonLd({ '@graph': [{ '@type': 'WebPage' }, { ...POSTING, '@type': ['JobPosting'] }] }));
      eq(extract().source, 'jsonld');
    });
    it('skips broken JSON-LD and falls back', () => {
      html('<script type="application/ld+json">{ not json</script><div><h1>Dev</h1><div>' + JD_HTML + '</div></div>');
      eq(extract().source, 'heuristic');
    });
    it('uses Greenhouse selectors on greenhouse.io', () => {
      html('<h1 class="app-title">Backend Dev</h1><div class="job__description">' + JD_HTML + '</div>');
      const r = extract('boards.greenhouse.io');
      eq([r.source, r.title], ['greenhouse', 'Backend Dev']);
    });
    it('uses Lever selectors and reads the company from the logo alt text', () => {
      html('<div class="main-header-logo"><img alt="Acme Inc"></div><div class="posting-headline"><h2>Data Eng</h2></div><div class="content-wrapper"><div class="content">' + JD_HTML + '</div></div>');
      const r = extract('jobs.lever.co');
      eq([r.source, r.title, r.company], ['lever', 'Data Eng', 'Acme Inc']);
    });
    it('uses Workday selectors', () => {
      html('<h2 data-automation-id="jobPostingHeader">Analyst</h2><div data-automation-id="jobPostingDescription">' + JD_HTML + '</div>');
      eq(extract('acme.wd5.myworkdayjobs.com').source, 'workday');
    });
    it('uses Indeed selectors', () => {
      html('<h1>QA Lead</h1><div id="jobDescriptionText">' + JD_HTML + '</div>');
      eq(extract('www.indeed.com').source, 'indeed');
    });
    it('on LinkedIn, the visible job wins over stale JSON-LD (SPA navigation)', () => {
      html(jsonLd({ ...POSTING, title: 'OLD JOB' }) + '<h1 class="top-card-layout__title">NEW JOB</h1><div class="jobs-description__content">' + JD_HTML + '</div>');
      const r = extract('www.linkedin.com');
      eq([r.source, r.title], ['linkedin', 'NEW JOB']);
    });
    it('falls back to JSON-LD when a known site\'s layout changed', () => {
      html(jsonLd(POSTING) + '<div class="totally-new-layout">' + JD_HTML + '</div>');
      eq(extract('boards.greenhouse.io').source, 'jsonld');
    });
    it('heuristic picks the job description, not the navigation or footer', () => {
      html(`<nav><a>Home</a><a>Jobs</a><a>About</a></nav>
        <div id="jd"><h1>Platform Engineer</h1><div>${JD_HTML}</div></div>
        <footer>${'Copyright and cookies. '.repeat(30)}</footer>`);
      const r = extract('careers.unknown-company.com');
      eq(r.source, 'heuristic');
      includes(r.text, 'Kubernetes');
      eq(r.title, 'Platform Engineer');
    });
    it('returns null when there is no job description', () => {
      html('<h1>Welcome</h1><p>Short page.</p>');
      eq(extract(), null);
    });
    it('ignores a too-short JSON-LD description', () => {
      html(jsonLd({ ...POSTING, description: 'Short.' }));
      eq(extract(), null);
    });
    it('title is trimmed to one line', () => {
      html(jsonLd({ ...POSTING, title: 'Engineer\nApply now' }));
      eq(extract().title, 'Engineer');
    });
  }, { env: 'browser' });

  describe('job page reading › known job sites', () => {
    for (const h of ['www.linkedin.com', 'www.indeed.com', 'boards.greenhouse.io', 'jobs.lever.co', 'acme.wd1.myworkdayjobs.com', 'www.glassdoor.com', 'www.ziprecruiter.com', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com'])
      it(`${h} is recognized`, () => ok(AJP.jd.isKnownJobSite(h)));
    it('random sites are not', () => ok(!AJP.jd.isKnownJobSite('news.example.com')));
    it('look-alike domains are not (e.g. indeed.com.evil.io)', () => ok(!AJP.jd.isKnownJobSite('linkedin.com.evil.io')));
  }, { env: 'browser' });
})();
