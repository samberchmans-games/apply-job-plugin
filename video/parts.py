"""Scene list for the tester walkthrough videos. Each part follows a session in the Tester Guide."""
import json

RESUME = """# Ana Silva
ana.silva@example.com · Austin, TX

## Summary
Backend engineer with 8 years of experience building data platforms.

## Experience
### Senior Engineer — Acme Corp (2019–Present)
- Migrated customer data from on-prem Oracle to AWS
- Migrated 2TB of billing data to S3 with zero downtime
- Built REST APIs in Java and Spring Boot for the payments team
- Reduced nightly job failures by 30% through better retries
### Engineer — Globex (2015–2019)
- Wrote Python ETL jobs for reporting

## Skills
Languages: Java, Python, SQL
Cloud: AWS, Docker

## Education
B.S. Computer Science, UT Austin, 2015"""

JD = ("Senior Data Engineer at Initech. Requirements: lead migration of 10TB of data from on-prem to cloud; "
      "drive 20+ API migrations; keep the defect rate below 5%; Kubernetes required; 5+ years with Java or Python. "
      "Nice to have: Snowflake. Strong communication skills.")

PROFILE = {
    'personal': {'firstName': 'Ana', 'lastName': 'Silva', 'email': 'ana.silva@example.com', 'phone': '512-555-0100', 'city': 'Austin', 'state': 'TX',
                 'country': 'USA', 'linkedin': 'https://linkedin.com/in/ana-example', 'currentTitle': 'Senior Engineer', 'currentCompany': 'Acme Corp', 'yearsExperience': '8'},
    'skills': [{'name': n} for n in ['Java', 'Python', 'SQL', 'AWS', 'Docker', 'Spring', 'REST APIs', 'ETL']],
    'salary': {'min': '150000', 'max': '190000', 'currency': 'USD', 'period': 'year'},
    'areas': ['Austin, TX'], 'targetRoles': ['Senior Data Engineer'], 'workTypes': {'remote': True, 'hybrid': False, 'onsite': False},
    'autoApply': {'workAuthorized': 'Yes', 'requireSponsorship': 'No', 'education': [{'school': 'UT Austin', 'degree': 'B.S.', 'field': 'Computer Science', 'endYear': '2015'}],
                  'experience': [], 'eeo': {}},
}
SETTINGS = {'ai': {'provider': 'groq', 'model': '', 'keys': {'groq': 'gsk_demo_key_for_video_only', 'gemini': '', 'openrouter': ''}, 'ollamaUrl': 'http://localhost:11434'},
            'logLevel': 'info', 'autoAnalyze': True, 'learnAnswers': True, 'tracker': {'autoDetect': True, 'followUpDays': 7}}
RESUMES = {'activeId': 'r1', 'items': [{'id': 'r1', 'name': 'Main resume', 'text': RESUME, 'createdAt': '2026-11-01T10:00:00Z'}]}
BASE = {'profile': PROFILE, 'settings': SETTINGS, 'resumes': RESUMES}

ANALYSIS = {
    'requirements': [
        {'id': 'R1', 'text': 'Large on-prem to cloud data migration', 'priority': 'must', 'match': 'strong',
         'evidence': [{'quote': 'Migrated customer data from on-prem Oracle to AWS'}, {'quote': 'Migrated 2TB of billing data to S3 with zero downtime'}]},
        {'id': 'R2', 'text': 'API migrations', 'priority': 'must', 'match': 'partial', 'evidence': [{'quote': 'Built REST APIs in Java and Spring Boot for the payments team'}]},
        {'id': 'R3', 'text': 'Kubernetes', 'priority': 'must', 'match': 'none', 'evidence': []},
        {'id': 'R4', 'text': 'Snowflake', 'priority': 'nice', 'match': 'none', 'evidence': []},
        {'id': 'R5', 'text': 'Low defect / failure rate', 'priority': 'should', 'match': 'strong', 'evidence': [{'quote': 'Reduced nightly job failures by 30% through better retries'}]},
    ],
    'ats_keywords': ['data migration', 'AWS', 'Kubernetes', 'REST APIs', 'Snowflake', 'Java', 'on-prem'],
}
EDITS = {'edits': [
    {'target': 'b1', 'after': 'Led migration of customer data from on-prem Oracle to AWS, enabling retirement of legacy servers', 'requirement_ids': ['R1'], 'evidence': ['Migrated customer data from on-prem Oracle to AWS'], 'reason': 'Shows migration leadership'},
    {'target': 'b2', 'after': 'Led migration of 10TB of billing data to S3 with zero downtime', 'requirement_ids': ['R1'], 'evidence': ['Migrated 2TB of billing data to S3 with zero downtime'], 'reason': 'Match the job scale'},
    {'target': 'b3', 'after': 'Led 20+ API migrations in Java and Spring Boot for the payments team', 'requirement_ids': ['R2'], 'evidence': ['Built REST APIs in Java and Spring Boot for the payments team'], 'reason': 'API migrations'},
    {'target': 'b4', 'after': 'Cut nightly job failures by 30% by adding smarter retries, improving data reliability for downstream reports', 'requirement_ids': ['R5'], 'evidence': ['Reduced nightly job failures by 30% through better retries'], 'reason': 'Result first'},
    {'target': 'summary', 'after': 'Backend engineer with 8 years of experience leading data migrations to AWS and building Java REST APIs.', 'requirement_ids': ['R1', 'R2'], 'evidence': ['Backend engineer with 8 years of experience building data platforms.'], 'reason': 'Focus on the role'},
],
    'gap_advice': [{'requirement_id': 'R3', 'advice': 'Take a Kubernetes fundamentals course and containerize one ETL job as a side project.'},
                   {'requirement_id': 'R4', 'advice': 'Try the Snowflake free trial; mention your SQL depth in interviews.'}]}

J = json.dumps
MAKE_DRAFT = f"""H.fakeAI([{J(ANALYSIS)}, {J(EDITS)}]);
const r = await AJP.send('resume.enhance', {{ jd: {J(JD)}, job: {{ title: 'Senior Data Engineer', company: 'Initech' }} }});
window.__DRAFT__ = r.draft;"""

DAY = 86400000
APPS_JS = """const now = Date.now(), d = (n) => new Date(now - n * 86400000).toISOString();
await AJP.store.set('applications', [
 {id:'a1',url:'https://x.com/1',company:'Initech',title:'Senior Data Engineer',status:'applied',appliedAt:d(9),date:d(9),score:68,statusHistory:[{status:'applied',at:d(9)}],snapshot:{jd:'Requirements: data migration, Java, AWS…',savedAt:d(9)},resumeName:'Tailored — Initech — Senior Data Engineer'},
 {id:'a2',url:'https://x.com/2',company:'Globex',title:'Cloud Data Engineer',status:'interviewing',appliedAt:d(5),date:d(6),score:82,detectedBy:'confirmation',statusHistory:[{status:'applied',at:d(5)},{status:'interviewing',at:d(2)}]},
 {id:'a3',url:'https://x.com/3',company:'Umbrella',title:'Platform Engineer',status:'in progress',date:d(1),score:55},
 {id:'a4',url:'https://x.com/4',company:'Hooli',title:'Backend Engineer',status:'rejected',appliedAt:d(20),date:d(20),score:61,statusHistory:[{status:'applied',at:d(20)},{status:'rejected',at:d(12)}]},
 {id:'a5',url:'https://x.com/5',company:'Stark Industries',title:'Java Architect',status:'applied',appliedAt:d(2),date:d(2),score:74,detectedBy:'confirmation'}]);
await H.sleep(300);"""

LOGS = [
    {'t': '2026-11-18T10:00:00.120Z', 'lvl': 'info', 'ctx': 'content', 'sid': 's8k2j1aa', 'mod': 'content', 'msg': 'panel.draftAnswer start', 'tid': 't7f3k2m9'},
    {'t': '2026-11-18T10:00:01.410Z', 'lvl': 'error', 'ctx': 'bg', 'sid': 's0b9x2cd', 'mod': 'ai', 'msg': 'ai.draftAnswer failed', 'tid': 't7f3k2m9', 'code': 'AJP-AI-401',
     'data': {'ms': 1230, 'code': 'AJP-AI-401', 'error': 'The AI provider rejected the API key.', 'details': {'status': 401}}},
    {'t': '2026-11-18T10:03:00.000Z', 'lvl': 'info', 'ctx': 'frame', 'sid': 's9a1b2c3', 'mod': 'filler', 'msg': 'frame.autofill done', 'tid': 't2b8c4d1',
     'data': {'ms': 84, 'filled': 11, 'learned': 2, 'unknown': 1, 'questions': 1, 'host': 'boards.greenhouse.io'}},
]

OPEN_PANEL = "await AJP.send('analyzeTab', { tabId: 1 }); await H.waitFor(() => H.shadow() && H.shadow().querySelector('.badge') && /%/.test(H.shadow().querySelector('.badge').textContent));"


def card(title, kicker, say, text='', items=None):
    return {'kind': 'card', 'title': title, 'kicker': kicker, 'text': text, 'items': items or [], 'say': say}


PARTS = [
    {'title': 'Set up', 'scenes': [
        card('Part 1 · Set up', 'Apply Job Assistant · tester walkthrough', 'Welcome to the Apply Job Assistant tester walkthrough. In part one, we install the extension and set it up with the sample data from the tester guide.',
             'Follow along with the Tester Guide, Session 1. About 15 minutes.'),
        card('Install the extension', 'Check 1.1', 'First, install it. Download the ZIP from GitHub and unzip it. In Chrome, open the extensions page, turn on Developer mode, click Load unpacked, and choose the folder. The Admin page opens by itself.',
             items=['GitHub → branch develop → Code → Download ZIP → unzip', 'Chrome → chrome://extensions → turn on Developer mode', 'Load unpacked → choose the folder with manifest.json', 'Pin the extension from the puzzle icon']),
        {'kind': 'popup', 'say': 'Click the extension icon. The popup shows that nothing is set up yet, with a profile incomplete warning.', 'caption': 'Toolbar icon: nothing set up yet', 'check': '1.2'},
        {'kind': 'admin', 'hash': 'profile', 'seed': {'profile': PROFILE}, 'highlight': '#profile .grid',
         'say': 'Open Admin, then Profile. Fill in your name, email, phone, city and LinkedIn. Everything saves automatically, and stays only in your browser.', 'caption': 'Admin → Profile: fill in your details (saves automatically)', 'check': '1.3'},
        {'kind': 'admin', 'hash': 'skills', 'seed': {'profile': PROFILE, 'resumes': RESUMES},
         'actions': "H.fill('#skillName','k8s'); H.click('#skillForm button'); await H.sleep(300); H.fill('#skillName','Kubernetes'); H.click('#skillForm button'); H.pin('#toast'); await H.sleep(200);",
         'highlight': '#skillForm', 'say': 'In Skills, add k 8 s. It shows as Kubernetes. Add Kubernetes again, and you get: already in your list. Then remove it, so later tests match the guide.', 'caption': 'Skills: "k8s" becomes Kubernetes; duplicates are rejected', 'check': '1.4'},
        {'kind': 'admin', 'hash': 'resumes', 'seed': {'profile': PROFILE, 'resumes': RESUMES}, 'highlight': '#resumeList',
         'say': 'In Resumes, click New empty resume, and paste the sample resume from the guide. It is saved and marked active.', 'caption': 'Resumes: paste the sample resume → it becomes active', 'check': '1.5'},
        {'kind': 'admin', 'hash': 'skills', 'seed': {'profile': {**PROFILE, 'skills': []}, 'resumes': RESUMES}, 'actions': "H.click('#detectSkills'); await H.sleep(500);",
         'highlight': '#detectOut', 'say': 'Back in Skills, click Detect skills from my active resume. Java, Python, SQL, AWS and more are added.', 'caption': 'Skills → "Detect skills from my active resume"', 'check': '1.6'},
        {'kind': 'admin', 'hash': 'prefs', 'seed': {'profile': PROFILE}, 'highlight': '#prefs',
         'say': 'In Job preferences, set a minimum salary of one hundred fifty thousand, tick only Remote, and add Austin, Texas.', 'caption': 'Job preferences: salary, Remote only, Austin, TX', 'check': '1.7'},
        {'kind': 'admin', 'hash': 'ai', 'seed': BASE, 'actions': "H.fakeAI(['OK']); H.click('#aiTest'); await H.waitFor(() => /Works/.test(document.querySelector('#aiTestOut').textContent));",
         'highlight': ['#aiProvider', '#aiTestOut'], 'say': 'Last, in AI settings, choose Groq, paste your free API key, and click Test connection. You should see: works.', 'caption': 'AI settings: Groq + your free key → Test connection → ✅ Works', 'check': '1.9'},
        card('Part 1 done', 'Next: Part 2 · Match % on job pages', 'That is setup done. Mark checks one point one to one point nine in the guide. Next, part two: the match score on job pages.'),
    ]},
    {'title': 'Match on job pages', 'scenes': [
        card('Part 2 · Match % on job pages', 'Apply Job Assistant · tester walkthrough', 'Part two. We check that job posts are read correctly, and that the match score makes sense.', 'Tester Guide, Session 2. About 10 minutes.'),
        {'kind': 'job', 'seed': BASE, 'actions': OPEN_PANEL, 'highlight': 'shadow:.badge',
         'say': 'Open a job post on LinkedIn, Indeed, Greenhouse or Lever. A small badge with your match percentage appears. Click it to open the panel.', 'caption': 'Open a job post → the match % badge appears', 'check': '2.1'},
        {'kind': 'job', 'seed': BASE, 'actions': OPEN_PANEL, 'highlight': ['shadow:.chips'],
         'say': 'Green chips are skills you have. Red ones are missing. Amber means missing, but only nice to have. Compare them with the job post.', 'caption': 'Green = you have it · Red = missing · Amber = nice to have', 'check': '2.2'},
        {'kind': 'job', 'seed': BASE, 'actions': OPEN_PANEL, 'highlight': 'shadow:.fit',
         'say': 'The fit rows compare work type, salary and location with your preferences.', 'caption': 'Fit: work type, salary, location vs. your preferences', 'check': '2.7'},
        card('Any other page', 'Check 2.5 – 2.6', 'On any other careers site, click the extension icon, then Analyze this job page. Or select the job text, right-click, and choose analyze selection. Try it with the sample job in the guide.',
             items=['Toolbar icon → Analyze this job page', 'Or select the job text → right-click → Apply Job: analyze selection', 'Try it with the sample job in the Tester Guide']),
        card('Part 2 done', 'Next: Part 3 · Resume tailoring', 'Mark checks two point one to two point nine. Next, part three: resume tailoring, the most important session.'),
    ]},
    {'title': 'Resume tailoring', 'scenes': [
        card('Part 3 · Resume tailoring', 'The most important session', 'Part three, resume tailoring. The rule: tailoring must never make your resume untrue. No numbers copied from the job, no invented skills, employers or dates.',
             'Tester Guide, Session 3. About 20 minutes.'),
        {'kind': 'job', 'seed': BASE, 'actions': OPEN_PANEL + "\nH.fakeAI([" + J(ANALYSIS) + "," + J(EDITS) + "]); H.shadow().querySelector('[data-act=\"tailor\"]').click(); await H.waitFor(() => /job requirements/.test(H.shadow().textContent), 8000);",
         'highlight': 'shadow:.msg', 'budget': 9000, 'say': 'In the panel, click Tailor resume. After about forty seconds you get a summary: how many requirements, how many you meet, and how many edits are suggested. Click Review.', 'caption': 'Panel → 📝 Tailor resume → summary → Review', 'check': '3.1'},
        {'kind': 'admin', 'hash': 'resumes', 'seed': BASE, 'actions': MAKE_DRAFT + "\nawait AJP.enhanceView.open(window.__DRAFT__.id); await H.sleep(300);",
         'highlight': '#enhDialog .reqs', 'budget': 8000, 'say': 'The review screen lists what the job asks for, with your evidence quoted word for word from your resume. Kubernetes and Snowflake are marked not in resume.', 'caption': 'What the job asks for, and your evidence (quoted from your resume)', 'check': '3.3'},
        {'kind': 'admin', 'hash': 'resumes', 'seed': BASE, 'actions': MAKE_DRAFT + "\nawait AJP.enhanceView.open(window.__DRAFT__.id); await H.sleep(300); const c=[...document.querySelectorAll('#enhDialog .edit.blocked')][0]; c.scrollIntoView({block:'center'}); c.id='blk';",
         'highlight': '#blk', 'budget': 8000, 'say': 'Any change that copies a number from the job, like ten terabytes or twenty plus APIs, is blocked, and tells you why. Your own numbers, like two terabytes or thirty percent, are kept exactly.', 'caption': 'Job numbers (10TB, 20+, 5%) are blocked; your own numbers are kept', 'check': '3.5 – 3.6'},
        {'kind': 'admin', 'hash': 'resumes', 'seed': BASE, 'actions': MAKE_DRAFT + "\nawait AJP.enhanceView.open(window.__DRAFT__.id); await H.sleep(300); const m=document.querySelector('#enhDialog .metric').closest('.edit'); m.id='met';",
         'highlight': '#met', 'budget': 8000, 'say': 'Lines without a number describe the impact in words, and ask you for a real number if you have one. Type it in. Never use the job\'s numbers.', 'caption': 'No number? Impact in words + 💡 add YOUR real number', 'check': '3.7 – 3.8'},
        {'kind': 'admin', 'hash': 'resumes', 'seed': BASE, 'actions': MAKE_DRAFT + "\nawait AJP.enhanceView.open(window.__DRAFT__.id); await H.sleep(300); document.querySelector('#enhActive').checked = true; document.querySelector('#enhCreate').scrollIntoView({block:'center'});",
         'highlight': ['#enhCreate', '#enhActive'], 'budget': 8000, 'say': 'Untick anything you don\'t want, tick make it my active resume, and click Create tailored resume. Your original stays unchanged. Check that names, titles, dates and education are identical.', 'caption': 'Choose changes → Create tailored resume (original stays unchanged)', 'check': '3.9 – 3.10'},
        card('Part 3 done', 'Next: Part 4 · Autofill', 'Mark checks three point one to three point eleven, and note how useful the suggestions were. Next, part four: autofill.'),
    ]},
    {'title': 'Autofill and tracker', 'scenes': [
        card('Part 4 · Autofill & tracker', 'Apply Job Assistant · tester walkthrough', 'Part four covers autofill and the application tracker. Use a real application form, but do not submit unless you really want to apply.', 'Tester Guide, Sessions 4 and 5. About 20 minutes.'),
        {'kind': 'job', 'seed': BASE, 'actions': OPEN_PANEL + "\nH.shadow().querySelector('[data-act=\"autofill\"]').click(); await H.waitFor(() => /Filled/.test(H.shadow().textContent), 6000); document.querySelector('form').scrollIntoView({block:'start'});",
         'highlight': 'form', 'budget': 8000, 'say': 'On an application form, click Autofill form. Your details are filled in with green outlines. Check the yes and no answers, and that nothing was submitted.', 'caption': '⚡ Autofill: fields filled from your profile (never submitted)', 'check': '4.1 – 4.8'},
        {'kind': 'job', 'seed': BASE, 'actions': OPEN_PANEL + "\nH.shadow().querySelector('[data-act=\"autofill\"]').click(); await H.waitFor(() => H.shadow().querySelector('[data-act=\"draft\"]'), 6000);",
         'highlight': 'shadow:.q', 'budget': 8000, 'say': 'For free-text questions, click Draft answer with AI. It writes an answer using only facts from your resume. Answers you type yourself are remembered for next time.', 'caption': 'Free-text questions: ✨ Draft answer with AI', 'check': '4.5 – 4.7'},
        {'kind': 'admin', 'hash': 'applications', 'seed': BASE, 'actions': APPS_JS + "\nawait AJP.trackerView.render(); await H.sleep(200);", 'highlight': '#trkView', 'budget': 7000,
         'say': 'Click Mark applied, or just apply. The confirmation page is detected. In Admin, Applications, drag cards between columns, and see reminders when a follow-up is due.', 'caption': 'Applications board: drag between columns · reminders · Export CSV', 'check': '5.1 – 5.7'},
        {'kind': 'admin', 'hash': 'applications', 'seed': BASE, 'actions': APPS_JS + "\nawait AJP.trackerView.render(); await H.sleep(200); AJP.trackerView.renderDetail('a1'); await H.sleep(200);", 'highlight': '#trkDetail', 'budget': 7000,
         'say': 'Open a card to add notes, a recruiter and an interview date, and to reread the saved job description.', 'caption': 'Card details: notes, interview date, saved job description', 'check': '5.5 – 5.6'},
        card('Part 4 done', 'Next: Part 5 · Support & reporting', 'Mark the checks in sessions four and five. Last, part five: reporting problems.'),
    ]},
    {'title': 'Support and reporting', 'scenes': [
        card('Part 5 · Support & reporting', 'Apply Job Assistant · tester walkthrough', 'Part five. How errors are explained, and how to send us a report when something fails.', 'Tester Guide, Session 6 and "How to report a problem".'),
        {'kind': 'admin', 'hash': 'logs', 'seed': {**BASE, 'logs': LOGS}, 'highlight': ['#errSummary', '#logView'], 'budget': 6000,
         'say': 'Every error has a code, like A J P, A I, four oh one, with a hint on how to fix it. In Logs and support, click a code or a blue trace id to see just that action.', 'caption': 'Every error has a code + hint · click a trace id to follow one action', 'check': '6.1 – 6.3'},
        {'kind': 'admin', 'hash': 'logs', 'seed': {**BASE, 'logs': LOGS}, 'actions': "H.click('#reportOpen'); H.fill('#reportText','Draft answer with AI failed on a Lever application.');", 'highlight': '#reportDialog', 'budget': 6000,
         'say': 'When a check fails, click Report an issue, describe what happened, and download the report. It contains no personal data. Send it with the check number.', 'caption': '🆘 Report an issue → Download report → send it with the check number', 'check': '6.4 – 6.6'},
        card('Thank you for testing!', 'How to report', 'Set each check to pass, fail or blocked in the guide. For every fail, send the check number, the report file, and a screenshot if you can. Thank you for testing!',
             items=['Set each check: Pass · Fail · Blocked', 'For every Fail: check number + report file (R-…) + screenshot', 'Send to the person who invited you']),
    ]},
]

# ---- Part 6: career tracks ------------------------------------------------------------------------
TRACKS = [
    {'id': 'cloud', 'name': 'AWS Cloud Architect', 'targetTitles': ['Cloud Architect', 'Solutions Architect'], 'skills': [{'name': n} for n in ['AWS', 'Terraform', 'Kubernetes', 'Docker']], 'resumeId': None},
    {'id': 'java', 'name': 'Java Architect', 'targetTitles': ['Java Architect', 'Backend Architect'], 'skills': [{'name': n} for n in ['Java', 'Spring', 'Microservices', 'Kafka', 'REST APIs']], 'resumeId': 'r1'},
]
PROFILE_T = {**PROFILE, 'tracks': TRACKS}
EVALS = [
    {'jobKey': 'k1', 'url': 'https://x.com/1', 'title': 'Senior Cloud Architect', 'company': 'Initech', 'at': '2026-11-17T10:00:00Z', 'bestTrackId': 'cloud', 'scores': {'cloud': 84, 'java': 46}, 'gaps': {'cloud': ['Kubernetes', 'Terraform'], 'java': ['AWS']}},
    {'jobKey': 'k2', 'url': 'https://x.com/2', 'title': 'Java Architect', 'company': 'Globex', 'at': '2026-11-16T10:00:00Z', 'bestTrackId': 'java', 'scores': {'cloud': 38, 'java': 88}, 'gaps': {'cloud': ['Kubernetes', 'Spring'], 'java': ['Kafka']}},
    {'jobKey': 'k3', 'url': 'https://x.com/3', 'title': 'Solutions Architect (AWS)', 'company': 'Hooli', 'at': '2026-11-15T10:00:00Z', 'bestTrackId': 'cloud', 'scores': {'cloud': 72, 'java': 51}, 'gaps': {'cloud': ['Kubernetes'], 'java': ['AWS', 'Kafka']}},
]
BASE_T = {**BASE, 'profile': PROFILE_T, 'evaluations': EVALS}

PARTS.append({'title': 'Career tracks', 'scenes': [
    card('Part 6 · Career tracks', 'New in this version', 'Part six, career tracks. If you are looking in more than one direction, like AWS cloud architect and Java architect, set up to three tracks. Every job is scored against each one.',
         'Tester Guide, Session 7. About 10 minutes.'),
    {'kind': 'admin', 'hash': 'tracks', 'seed': BASE_T, 'actions': 'await H.sleep(400); document.querySelector(".track").id = "t1";', 'highlight': '#t1 .grid', 'budget': 6000,
     'say': 'In Admin, Career tracks, click Add track. Give it a name, target job titles, the extra skills for that direction, and optionally its own resume. Your Skills tab holds the core skills shared by all tracks.',
     'caption': 'Admin → Career tracks: name, target titles, track skills, resume', 'check': '7.1 – 7.2'},
    {'kind': 'job', 'seed': BASE_T, 'actions': OPEN_PANEL, 'highlight': 'shadow:.tracks', 'budget': 6000,
     'say': 'On a job page, the panel now shows a score for each track. The best fit is starred and selected automatically.', 'caption': 'Panel: a score per track · ★ = best fit, selected automatically', 'check': '7.3'},
    {'kind': 'job', 'seed': BASE_T, 'actions': OPEN_PANEL + "\nH.shadow().querySelectorAll('.tk')[1].click(); await H.sleep(300);", 'highlight': 'shadow:.tracks', 'budget': 6000,
     'say': 'Click another track to switch. Tailor resume, autofill, and mark applied then use that track\'s skills and resume.', 'caption': 'Switch track → tailoring, autofill and tracking use that track', 'check': '7.4 – 7.6'},
    {'kind': 'admin', 'hash': 'tracks', 'seed': BASE_T, 'actions': 'await H.sleep(500);', 'highlight': '[data-ins="cloud"]', 'budget': 6000,
     'say': 'Back in Career tracks, each track shows how many jobs you evaluated, your average match, and the gaps that come up most, so you know what to learn next.',
     'caption': 'Insights per track · most frequent gaps = what to learn next', 'check': '7.7'},
    {'kind': 'admin', 'hash': 'tracks', 'seed': BASE_T, 'actions': 'await H.sleep(500); document.querySelectorAll(".track .grid, .track .row, #tracks > .hint").forEach((e) => (e.style.display = "none")); window.scrollTo(0, 0);', 'highlight': '#trackCompare', 'budget': 6000,
     'say': 'At the bottom, the table compares your recent jobs across tracks. The star marks the best track for each job.',
     'caption': 'Compare recent jobs across your tracks (★ = best track)', 'check': '7.8'},
    card('Part 6 done', 'Thank you for testing!', 'Mark checks seven point one to seven point nine in the guide. Thank you for testing!'),
]})
