/*
 * "Remote" can mean "only in these countries". A remote job anywhere or in your country fits; one listed only in other
 * countries is flagged on the job page and left out of Job Radar; when either side is unknown the job is shown.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const M = AJP.matcher;
  const C = AJP.radar.core;
  const JD = 'Data Platform Engineer. We are remote-friendly, and you will enjoy flexible hours. Remote work. Python and SQL.';
  const profile = (o = {}) => ({ skills: [{ name: 'Python' }], areas: ['NJ'], workTypes: { remote: true, hybrid: true, onsite: true }, targetRoles: ['Data Platform Engineer'], tracks: [], personal: {}, ...o });
  const fit = (jobLocation, p = profile(), jdText = JD) => M.analyze({ jdText, jobLocation, profile: p }).fit.location;

  describe('location fit › which country', () => {
    it('US states, codes and names count as the US', () => {
      for (const x of ['NJ', 'Austin, TX', 'New Jersey', 'Remote - US', 'United States', 'USA', 'Jersey City, NJ 07302']) ok(M.countriesIn([x]).has('united states'), x);
    });
    it('other countries are recognized; ordinary words are not states', () => {
      eq([...M.countriesIn(['The Netherlands'])], ['netherlands']);
      eq(M.countriesIn(['Remote']).size, 0);
      eq(M.countriesIn(['Toronto']).size, 0);
    });
  });

  describe('location fit › the job panel', () => {
    it('remote, listed only in another country (the reported job): flagged, not a green check', () => {
      const f = fit('Amsterdam, Netherlands, Netherlands');
      eq([f.ok, f.abroad, f.remote, f.matched, f.home], [false, true, true, null, 'united states']);
    });
    it('"NJ" is not found inside "enjoy"', () => {
      eq(fit('', profile({ workTypes: { onsite: true } }), 'You will enjoy this on-site role.').matched, null);
      eq(fit('', profile({ workTypes: { onsite: true } }), 'On-site role in Newark, NJ.').matched, 'NJ');
    });
    it('remote in your country, remote anywhere, or no country named: a fit', () => {
      for (const l of ['Remote US', 'United States', 'Remote - Worldwide', 'Anywhere', 'Remote', '']) eq([l, fit(l).ok, fit(l).abroad], [l, true, false]);
    });
    it('your country comes from your areas, else your profile', () => {
      const p = profile({ areas: [], personal: { country: 'United States' } });
      eq(fit('Berlin, Germany', p).abroad, true);
      eq(fit('Berlin, Germany', profile({ areas: [] })).abroad, false, 'home unknown: show it');
    });
    it('someone in that country gets a normal fit', () => {
      eq(fit('Amsterdam, Netherlands', profile({ areas: ['Amsterdam, Netherlands'] })).ok, true);
    });
  });

  describe('location fit › Job Radar', () => {
    const job = (locations) => C.normalize({ id: 1, title: 'Data Platform Engineer', locations, raw: { workplaceType: 'remote' } }, { board: 'ashby', company: 'x' });
    const tracked = () => profile({ targetRoles: [], areas: [], tracks: [{ id: 'e', name: 'Engineer', targetTitles: ['Data Engineer'], areas: ['NJ'] }] });
    it('remote in four European countries is left out for a track in NJ', () => {
      eq(C.quickFilter(job(['The Netherlands', 'United Kingdom', 'Spain', 'Germany']), {}, tracked()).reason, 'location');
    });
    it('the same job with a US location, or open worldwide, is shown', () => {
      ok(C.quickFilter(job(['The Netherlands', 'United States']), {}, tracked()).pass);
      ok(C.quickFilter(job(['Remote - Anywhere', 'Germany']), {}, tracked()).pass);
      ok(C.quickFilter(job(['Remote']), {}, tracked()).pass);
    });
    it('a track without locations uses your profile’s country', () => {
      const p = profile({ targetRoles: [], areas: [], personal: { country: 'USA' }, tracks: [{ id: 'd', name: 'Data', targetTitles: ['Data Engineer'] }] });
      eq(C.quickFilter(job(['Germany']), {}, p).reason, 'location');
    });
  });

  describe('location fit › panel text', () => {
    afterEach(() => AJP.panel.remove());
    it('says the job is remote but listed outside the US', () => {
      const a = M.analyze({ jdText: JD, jobLocation: 'Amsterdam, Netherlands', profile: profile() });
      AJP.panel.render({ job: { title: 'Dev', location: 'Amsterdam, Netherlands' }, analysis: a }, {});
      const t = document.querySelector('ajp-panel').shadowRoot.textContent;
      includes(t, 'remote, but listed outside the US: check you can work there');
      includes(t, '⚠️');
    });
  }, { env: 'browser' });
})();
