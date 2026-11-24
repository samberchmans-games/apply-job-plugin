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

  // The layout of a real report (anonymised): "CAREER PROFILE", one line per role "Title | Company (Place) Mon Year – Mon Year",
  // a summary paragraph, sub-headings and "Environment:" lines between the bullets.
  const CAREER = `PROFESSIONAL SUMMARY
Data architect with 15+ years of experience.
TECHNICAL SKILLS
Cloud (AWS): S3, EC2
CAREER PROFILE
Architect / Lead Data Engineer | Example Infotech Dec 2022 – Present
Lead a cross-functional team of 6 engineers building enterprise data pipelines.
Architecture
• Used keyed merge loads so reruns never create duplicates.
Data Engineering, Integration & Cloud Migration
• Led the migration from one database to another in 2020 – 2021.
Tools: Java Spring Boot, Python
Associate VP – Data Integration | Sample Bank Nov 2021 – Dec 2022
Built a low-latency, event-driven platform for traders.
• Onboarded data tenants.
Environment: Kafka, Spring Boot
Team Lead | Example Consulting (NJ, US) Jun 2015 – Nov 2019
Projects: B2C and TADA.
• Processed flat-file data.
Senior Developer | Example Consulting (Bangalore, India) Jan 2012 – May 2015
C++ Developer | Example Consulting Internal, Bangalore Jun 2011 – Dec 2011
• Developed reusable components.
EDUCATION
B.Tech, Electronics and Communication Engineering, Example University, Coimbatore, India (2011)
OTHER INTERESTS (SELF-STUDY)
• Built a mobile card game.`;

  describe('resume facts › "Career profile" and one-line roles (real layout)', () => {
    it('every role, with title, company, place and month dates', () => {
      eq(F().fromText(CAREER).experience.map((j) => [j.title, j.company, j.location, j.start, j.end]), [
        ['Architect / Lead Data Engineer', 'Example Infotech', '', '12/2022', 'Present'],
        ['Associate VP – Data Integration', 'Sample Bank', '', '11/2021', '12/2022'],
        ['Team Lead', 'Example Consulting', 'NJ, US', '06/2015', '11/2019'],
        ['Senior Developer', 'Example Consulting', 'Bangalore, India', '01/2012', '05/2015'],
        ['C++ Developer', 'Example Consulting Internal', 'Bangalore', '06/2011', '12/2011'],
      ]);
    });
    it('the degree with its field and school', () => {
      eq(F().fromText(CAREER).education, [{ school: 'Example University', degree: 'B.Tech', field: 'Electronics and Communication Engineering', startYear: '', endYear: '2011' }]);
    });
  });

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
