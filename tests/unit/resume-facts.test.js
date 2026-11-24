/*
 * Work history and education read from the resume (resume-facts.js). Autofill uses the resume it applies with, so
 * nobody types their jobs and schools a second time. Anonymised resumes in the layouts people actually use.
 */
(function () {
  const { describe, it, eq, ok } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const F = () => AJP.resumeFacts;

  const MARKDOWN = `# Alex Example
## Experience
### Lead Data Engineer, Northwind Retail (2019 - Present)
- Built a Python and Airflow platform
### Data Engineer, Contoso Health (2014 - 2019)
- Developed Spark jobs
## Skills
Python, SQL
## Education
B.S. Computer Science, State University (2007 - 2011)`;

  const PLAIN = `ALEX EXAMPLE
alex@example.com

PROFESSIONAL EXPERIENCE
Northwind Retail | Jersey City, NJ | Jan 2019 – Present
Lead Data Engineer
• Built a Python and Airflow platform that loads 400 tables every night
• Mentored five engineers
Contoso Health Inc., Austin, TX                06/2014 - 12/2018
Senior Data Engineer
• Developed Spark jobs on Databricks

EDUCATION
Master of Science in Data Science, Example University, 2014
B.Tech in Computer Science — Sample Institute of Technology (2003 - 2007)`;

  const AT = `Experience
Senior Data Engineer at Fabrikam Bank (Mar 2011 – May 2014)
- Maintained ETL jobs
Education
Bachelor of Engineering, Electronics
Example College of Engineering, 2010`;

  describe('resume facts › work history', () => {
    it('"Title, Company (years)"', () => {
      eq(F().fromText(MARKDOWN).experience, [
        { title: 'Lead Data Engineer', company: 'Northwind Retail', location: '', start: '2019', end: 'Present', current: true },
        { title: 'Data Engineer', company: 'Contoso Health', location: '', start: '2014', end: '2019', current: false },
      ]);
    });
    it('"Company | City, ST | Month Year – Present" with the title on the next line', () => {
      const x = F().fromText(PLAIN).experience;
      eq(x.map((j) => [j.title, j.company, j.location, j.start, j.end]), [
        ['Lead Data Engineer', 'Northwind Retail', 'Jersey City, NJ', '01/2019', 'Present'],
        ['Senior Data Engineer', 'Contoso Health Inc.', 'Austin, TX', '06/2014', '12/2018'],
      ]);
    });
    it('"Title at Company (Mon Year – Mon Year)"', () => {
      eq(F().fromText(AT).experience.map((j) => [j.title, j.company, j.start, j.end]), [['Senior Data Engineer', 'Fabrikam Bank', '03/2011', '05/2014']]);
    });
    it('bullets are never taken as jobs', () => {
      ok(F().fromText(PLAIN).experience.every((j) => !/Built|Mentored|Spark/.test(j.title + j.company)));
    });
  });

  describe('resume facts › education', () => {
    it('degree, field, school and years on one line', () => {
      eq(F().fromText(MARKDOWN).education, [{ school: 'State University', degree: 'B.S.', field: 'Computer Science', startYear: '2007', endYear: '2011' }]);
    });
    it('"Master of Science in X, School, Year" and "B.Tech in X — Institute (years)"', () => {
      eq(F().fromText(PLAIN).education.map((e) => [e.degree, e.field, e.school, e.startYear, e.endYear]), [
        ['Master of Science', 'Data Science', 'Example University', '', '2014'],
        ['B.Tech', 'Computer Science', 'Sample Institute of Technology', '2003', '2007'],
      ]);
    });
    it('degree and school on separate lines are one entry', () => {
      eq(F().fromText(AT).education.map((e) => [e.degree, e.field, e.school, e.endYear]), [['Bachelor of Engineering', 'Electronics', 'Example College of Engineering', '2010']]);
    });
  });

  describe('resume facts › used by autofill', () => {
    const profile = () => {
      const p = AJP.clone(AJP.store.DEFAULTS.profile);
      p.autoApply.experience = [{ title: 'Typed by hand', company: 'Old Co' }];
      return p;
    };
    it('the resume replaces what was typed in Admin', () => {
      const p = F().apply(profile(), { name: 'Base resume', text: PLAIN });
      eq(p.autoApply.experience.map((j) => j.company), ['Northwind Retail', 'Contoso Health Inc.']);
      eq(p.fromResume, { name: 'Base resume', jobs: 2, schools: 2 });
    });
    it('a resume with no dated jobs keeps the Admin list', () => {
      eq(F().apply(profile(), { text: 'Alex Example\nSkills\nPython' }).autoApply.experience[0].company, 'Old Co');
    });
    it('no resume: the profile is unchanged', () => eq(F().apply(profile(), null).autoApply.experience[0].company, 'Old Co'));
  });
})();
