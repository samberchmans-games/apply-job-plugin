(function () {
  const { describe, it, eq, ok, notOk, includes } = globalThis.AJPTest;
  const T = globalThis.AJP.tracker;
  const DAY = 86400000;
  const NOW = Date.parse('2026-11-18T12:00:00Z');
  const ago = (days) => new Date(NOW - days * DAY).toISOString();

  describe('tracker › job identity (same job, different URLs)', () => {
    const same = (a, b) => eq(T.jobKey(a), T.jobKey(b), `${a} vs ${b}`);
    it('LinkedIn: view page, slug, and search page with currentJobId', () => {
      same('https://www.linkedin.com/jobs/view/4012345678/?trk=abc', 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=java');
      same('https://www.linkedin.com/jobs/view/senior-java-architect-at-acme-4012345678', 'https://linkedin.com/jobs/view/4012345678');
      eq(T.jobKey('https://www.linkedin.com/jobs/view/4012345678'), 'linkedin:4012345678');
    });
    it('Indeed: jk and vjk', () => same('https://www.indeed.com/viewjob?jk=abc123&from=serp', 'https://www.indeed.com/jobs?q=x&vjk=abc123'));
    it('Greenhouse: board page, apply anchor, and gh_jid on a company site', () => {
      same('https://boards.greenhouse.io/acme/jobs/5551234', 'https://boards.greenhouse.io/acme/jobs/5551234#app');
      same('https://boards.greenhouse.io/acme/jobs/5551234', 'https://careers.acme.com/open-roles?gh_jid=5551234');
    });
    it('Lever: posting and /apply', () =>
      same('https://jobs.lever.co/acme/1b2c3d4e-1111-2222-3333-444455556666', 'https://jobs.lever.co/acme/1b2c3d4e-1111-2222-3333-444455556666/apply'));
    it('Workday: job page and apply flow', () => {
      same('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Senior-Engineer_R12345', 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Senior-Engineer_R12345/apply/applyManually');
      eq(T.jobKey('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Senior-Engineer_R12345'), 'workday:acme:R12345');
    });
    it('Ashby, SmartRecruiters, Glassdoor', () => {
      same('https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666', 'https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666/application');
      eq(T.jobKey('https://jobs.smartrecruiters.com/Acme/743999912345678-java-architect'), 'smartrecruiters:743999912345678');
      eq(T.jobKey('https://www.glassdoor.com/job-listing/x?jl=1009876'), 'glassdoor:1009876');
    });
    it('other sites: host + path, ignoring query, hash, trailing slash and /apply', () => {
      same('https://careers.example.com/jobs/java-architect/?utm_source=x#top', 'https://careers.example.com/jobs/java-architect/apply');
      ok(T.jobKey('https://careers.example.com/jobs/a') !== T.jobKey('https://careers.example.com/jobs/b'));
    });
    it('different jobs get different keys', () => ok(T.jobKey('https://www.linkedin.com/jobs/view/111111') !== T.jobKey('https://www.linkedin.com/jobs/view/222222')));
    it('invalid URL gives an empty key', () => eq(T.jobKey('not a url'), ''));
    it('known job sites', () => {
      ok(T.isJobHost('www.linkedin.com'));
      ok(T.isJobHost('acme.wd5.myworkdayjobs.com'));
      notOk(T.isJobHost('example.com'));
      notOk(T.isJobHost('linkedin.com.evil.io'));
    });
  });

  describe('tracker › duplicate warning', () => {
    const apps = [
      { id: 'a', url: 'https://www.linkedin.com/jobs/view/4012345678', company: 'Acme Inc.', title: 'Senior Java Architect', status: 'applied' },
    ];
    it('same job via a different URL', () => eq(T.findDuplicate(apps, { url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678' }).how, 'same job'));
    it('same company + nearly the same title on another site', () => {
      const d = T.findDuplicate(apps, { url: 'https://acme.wd5.myworkdayjobs.com/x/job/y/Sr_R1', company: 'ACME', title: 'Senior Java Architect (Remote)' });
      eq([d.how, d.app.id], ['similar job', 'a']);
    });
    it('same company, different role is not a duplicate', () => eq(T.findDuplicate(apps, { url: 'https://x.com/1', company: 'Acme', title: 'AWS Cloud Architect' }), null));
    it('different company, same title is not a duplicate', () => eq(T.findDuplicate(apps, { url: 'https://x.com/1', company: 'Globex', title: 'Senior Java Architect' }), null));
    it('nothing tracked yet', () => eq(T.findDuplicate([], { url: 'https://x.com/1' }), null));
    it('title similarity', () => {
      eq(T.titleSimilarity('Java Architect', 'Java Architect'), 1);
      ok(T.titleSimilarity('Senior Java Architect', 'AWS Cloud Architect') < 0.5);
    });
  });

  describe('tracker › saving rules', () => {
    const base = { url: 'https://www.linkedin.com/jobs/view/4012345678', title: 'Java Architect', company: 'Acme' };
    it('a new application gets id, date, history and key', () => {
      const r = T.upsert([], { ...base, status: 'in progress' }, ago(1));
      ok(r.created && r.app.id);
      eq(r.app.statusHistory, [{ status: 'in progress', at: ago(1) }]);
      eq(r.app.jobKey, 'linkedin:4012345678');
      eq(r.app.appliedAt, undefined);
    });
    it('marking applied records appliedAt once', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'applied' }, ago(5));
      T.upsert(list, { ...base, status: 'interviewing' }, ago(2));
      eq(list[0].appliedAt, ago(5));
    });
    it('the same job from another URL updates instead of duplicating', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'in progress' });
      T.upsert(list, { url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678', status: 'applied' });
      eq(list.length, 1);
      eq(list[0].status, 'applied');
    });
    it('BUG FIX: automatic updates never move status backwards (Autofill after applied)', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'applied' });
      T.upsert(list, { ...base, status: 'in progress', auto: true });
      eq(list[0].status, 'applied');
      T.upsert(list, { ...base, status: 'interviewing' });
      T.upsert(list, { ...base, status: 'applied', auto: true });
      eq(list[0].status, 'interviewing');
    });
    it('manual changes may move status backwards', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'interviewing' });
      T.upsert(list, { id: list[0].id, status: 'applied' });
      eq(list[0].status, 'applied');
    });
    it('empty values never wipe saved data', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'applied', notes: 'called Bob', snapshot: { jd: 'JD TEXT' } });
      T.upsert(list, { url: base.url, title: '', company: null, notes: undefined, status: 'applied' });
      eq([list[0].title, list[0].company, list[0].notes, list[0].snapshot.jd], ['Java Architect', 'Acme', 'called Bob', 'JD TEXT']);
    });
    it('unknown statuses are ignored', () => eq(T.upsert([], { ...base, status: 'hacked' }).app.status, 'in progress'));
    it('history only grows when status changes', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'applied' });
      T.upsert(list, { ...base, status: 'applied', notes: 'x' });
      eq(list[0].statusHistory.length, 1);
    });
    it('undo returns to the previous status', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'in progress' });
      T.upsert(list, { ...base, status: 'applied' });
      const r = T.undoStatus(list, list[0].id);
      eq([r.removed, r.app.status, r.app.appliedAt, r.app.statusHistory.length], [false, 'in progress', undefined, 1]);
    });
    it('undo on a just-added application removes it (mis-click)', () => {
      const list = [];
      T.upsert(list, { ...base, status: 'applied' });
      eq(T.undoStatus(list, list[0].id).removed, true);
      eq(list.length, 0);
    });
    it('undo with an unknown id does nothing', () => eq(T.undoStatus([], 'nope'), null));
    it('list is capped at 2000', () => {
      const list = Array.from({ length: 2000 }, (_, i) => ({ id: 'x' + i, url: 'https://e.com/' + i, jobKey: 'url:e.com/' + i, status: 'applied' }));
      T.upsert(list, { url: 'https://e.com/new', status: 'applied' });
      eq(list.length, 2000);
      eq(list[0].url, 'https://e.com/new');
    });
  });

  describe('tracker › recognizing submit & confirmation', () => {
    for (const t of ['Thank you for applying!', 'Thanks for applying to Acme', 'Application submitted', 'Your application was sent to Acme', 'Your application has been submitted successfully', "We've received your application", 'Application received', 'You’ve successfully applied', 'Thank you for your application'])
      it(`confirms: "${t}"`, () => ok(T.isConfirmationText(t)));
    for (const t of ['Once your application has been submitted, we will review it.', 'After applying, a recruiter will reach out.', 'Your application could not be submitted. Please try again.', 'Your application has not been submitted', 'Thank you for your interest in Acme', 'Apply for this job', 'x'.repeat(320) + ' thank you for applying'])
      it(`does not confirm: "${t.slice(0, 60)}"`, () => notOk(T.isConfirmationText(t)));
    it('confirmation URLs', () => {
      ok(T.isConfirmationUrl('https://boards.greenhouse.io/acme/jobs/1/confirmation'));
      ok(T.isConfirmationUrl('https://jobs.lever.co/acme/uuid/thanks'));
      ok(T.isConfirmationUrl('https://x.com/application-submitted'));
      notOk(T.isConfirmationUrl('https://boards.greenhouse.io/acme/jobs/1'));
      notOk(T.isConfirmationUrl('https://example.com/thanksgiving-sale'));
    });
    for (const t of ['Submit', 'Submit application', 'Submit Application', 'Apply', 'Apply now', 'Send application', 'Review and submit'])
      it(`submit button: "${t}"`, () => ok(T.isSubmitLabel(t)));
    for (const t of ['Save draft', 'Next', 'Submit a referral', 'Apply filters', 'Sign in'])
      it(`not a submit button: "${t}"`, () => notOk(T.isSubmitLabel(t)));
  });

  describe('tracker › follow-up reminders', () => {
    const app = (o) => ({ id: Math.random().toString(36), status: 'applied', appliedAt: ago(1), ...o });
    it('applied 8 days ago with no reply → follow-up due', () => {
      const d = T.dueFollowUps([app({ appliedAt: ago(8) })], NOW, 7);
      eq([d.length, d[0].reason, d[0].days], [1, 'followup', 8]);
    });
    it('applied 3 days ago → not yet', () => eq(T.dueFollowUps([app({ appliedAt: ago(3) })], NOW, 7).length, 0));
    it('"I followed up" resets the clock', () => eq(T.dueFollowUps([app({ appliedAt: ago(20), lastFollowUpAt: ago(2) })], NOW, 7).length, 0));
    it('respects the configured number of days', () => eq(T.dueFollowUps([app({ appliedAt: ago(4) })], NOW, 3).length, 1));
    it('interview in the next 48h → due', () => {
      const d = T.dueFollowUps([app({ status: 'interviewing', interviewAt: new Date(NOW + DAY).toISOString() })], NOW, 7);
      eq(d[0].reason, 'interview');
    });
    it('interview far away or long past → not due', () => {
      eq(T.dueFollowUps([app({ status: 'interviewing', interviewAt: new Date(NOW + 5 * DAY).toISOString() })], NOW, 7).length, 0);
      eq(T.dueFollowUps([app({ status: 'interviewing', interviewAt: ago(2) })], NOW, 7).length, 0);
    });
    it('rejected / offer / withdrawn / started never nag', () => {
      for (const status of ['rejected', 'offer', 'withdrawn', 'in progress']) eq(T.dueFollowUps([app({ status, appliedAt: ago(30) })], NOW, 7).length, 0, status);
    });
  });

  describe('tracker › stats', () => {
    const apps = [
      { status: 'in progress', date: ago(1), score: 90 },
      { status: 'applied', appliedAt: ago(2), score: 60 },
      { status: 'applied', appliedAt: ago(10), score: 50 },
      { status: 'interviewing', appliedAt: ago(3), score: 85 },
      { status: 'rejected', appliedAt: ago(20), score: 70, statusHistory: [{ status: 'applied' }, { status: 'interviewing' }, { status: 'rejected' }] },
      { status: 'rejected', appliedAt: ago(30), score: 40, statusHistory: [{ status: 'applied' }, { status: 'rejected' }] },
    ];
    const st = T.stats(apps, NOW);
    it('counts tracked vs applied', () => eq([st.total, st.submitted], [6, 5]));
    it('counts by status', () => eq(st.byStatus, { 'in progress': 1, applied: 2, interviewing: 1, offer: 0, rejected: 2, withdrawn: 0 }));
    it('response rate = any reply (interview, offer or rejection)', () => eq(st.responseRate, 60));
    it('interview rate counts jobs that reached an interview, even if later rejected', () => eq(st.interviewRate, 40));
    it('average match of interviewed vs others', () => eq([st.avgScoreInterviewed, st.avgScoreNotInterviewed], [78, 50]));
    it('applications per week (last 8 weeks)', () => {
      eq(st.perWeek.length, 8);
      eq(st.thisWeek, 2);
      eq(st.perWeek.reduce((s, w) => s + w.count, 0), 5);
    });
    it('empty list gives no rates (not 0%)', () => {
      const e = T.stats([], NOW);
      eq([e.responseRate, e.interviewRate, e.avgScoreInterviewed], [null, null, null]);
    });
  });

  describe('tracker › CSV export', () => {
    const csv = T.toCSV([{ appliedAt: '2026-11-03T10:00:00Z', company: 'Acme, Inc.', title: 'Java "Lead" Architect', status: 'applied', score: 81, notes: 'line1\nline2', url: 'https://x.com/1', snapshot: { salary: { min: 150000, max: 190000 } } }]);
    const lines = csv.split('\r\n');
    it('starts with a BOM so Excel reads UTF-8', () => ok(csv.charCodeAt(0) === 0xfeff));
    it('has a header row', () => ok(lines[0].includes('Date applied,Company,Title,Status,Match %')));
    it('quotes commas, quotes and newlines', () => {
      includes(csv, '"Acme, Inc."');
      includes(csv, '"Java ""Lead"" Architect"');
      includes(csv, '"line1\nline2"');
    });
    it('includes date, salary and URL', () => {
      includes(csv, '2026-11-03');
      includes(csv, '150000-190000');
      includes(csv, 'https://x.com/1');
    });
    it('blocks spreadsheet formula injection from job pages', () => {
      eq(T.csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
      eq(T.csvCell('+1-555'), "'+1-555");
      eq(T.csvCell('@SUM(A1)'), "'@SUM(A1)");
    });
    it('empty list still exports a header', () => eq(T.toCSV([]).split('\r\n').length, 1));
  });
})();
