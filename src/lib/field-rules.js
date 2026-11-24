/*
 * field-rules.js — how a form question maps to the profile: { key, re (label pattern), v(profile) → value }.
 * Shared by the form filler (content scripts) and the profile suggestions (Admin), so both read a question
 * the same way. Order matters: question-style rules first (a long question can mention "country" or "phone"),
 * then short field rules, most specific first.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.FIELD_RULES) return;

  const yn = (v) => (v === true || /^y/i.test(v) ? 'Yes' : v === false || /^n/i.test(v) ? 'No' : '');
  const first = (arr) => (arr && arr[0]) || {};

  /*
   * "Have you previously been employed by Coinbase?" / "…worked for any of the following: Coinbase, Base or Bison
   * Trails?": every company the question names is checked against your work history (the resume being sent, then
   * your profile). One of them there → Yes; none → No. No work history known, or no company named → no answer.
   */
  const SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|pvt|private|technologies|group|holdings)\b\.?/gi;
  const orgKey = (s) => AJP.norm(String(s || '').replace(SUFFIX, ' ')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function namedCompanies(label) {
    const m = String(label || '').match(/\b(?:employed\s+(?:by|at|with)|worked\s+(?:for|at)|work(?:ing)?\s+for|been an? (?:employee|contractor|intern|consultant)\s+(?:of|at|for|with))\s+(.+?)(?=\s+(?:or any of its|or its|in any capacity|as an?|before|previously|in the past|at any time|during)\b|[?(]|\.\s|$)/i);
    if (!m) return [];
    let list = m[1];
    if (list.includes(':')) list = list.slice(list.indexOf(':') + 1);
    return list
      .split(/\s*(?:,|;|\/|\bor\b|\band\b)\s*/i)
      .map((x) => x.replace(/^(?:any of )?(?:the following(?: companies)?|its (?:affiliates?|subsidiaries))\s*/i, '').trim())
      // "a startup", "any company in fintech": no company named, so no answer.
      .filter((x) => x.length > 1 && !/^(a|an|any|another|some|other)\b/i.test(x) && !/^(us|we|this company|the company|our company|any (?:of )?(?:its )?(?:affiliates?|subsidiar(?:y|ies))|affiliates?|subsidiar(?:y|ies))$/i.test(x));
  }
  function previouslyEmployed(p, ctx) {
    const names = namedCompanies(ctx && ctx.label).map(orgKey).filter((x) => x.length > 1);
    const mine = [...((p.autoApply && p.autoApply.experience) || []).map((e) => e.company), p.personal && p.personal.currentCompany].map(orgKey).filter((x) => x.length > 1);
    if (!names.length || !mine.length) return '';
    const has = (a, b) => ` ${a} `.includes(` ${b} `);
    return names.some((n) => mine.some((h) => has(h, n) || has(n, h))) ? 'Yes' : 'No';
  }

  // Order matters: more specific patterns first.
  const RULES = [
    // Question-style rules first: a long question can mention "country", "state" or "phone" (e.g. "authorized to work
    // in the country…?") and must not be answered with an address field. Then short field rules, most specific first.
    // Screening questions (Admin → Auto-apply details → Screening questions); v(profile, { label }).
    // `dflt`: the answer when Admin has none AND you never answered it on a form (your own answers come first).
    { key: 'previouslyEmployed', re: /\b(previously|ever|formerly|in the past|before)\b[^?]{0,60}\b(employed (by|at|with)|worked (for|at)|work for|been an? (employee|contractor|intern) (of|at|for|with))|\bformer (employee|intern|contractor) of\b/i, v: previouslyEmployed },
    { key: 'over18', re: /\b(at least|over|older than)\s+(the age of\s+)?18\b|\b18 (years|yrs)( of age| old)|\b18 or older\b|\bage of (18|majority)\b|\blegal (working )?age\b/i, v: (p) => yn(p.autoApply.over18), dflt: 'Yes' },
    { key: 'govRelative', re: /(relative|family member|spouse|partner|related to)[^?]{0,80}government|government[^?]{0,80}(relative|family member)/i, v: (p) => yn(p.autoApply.govRelative), dflt: 'No' },
    { key: 'govOfficial', re: /government official|public official|politically exposed|government[- ](agency|employee|owned)|public office|civil service/i, v: (p) => yn(p.autoApply.govOfficial), dflt: 'No' },
    { key: 'conflict', re: /conflict of interest|significant financial interest|close personal relationship|referred[^?]{0,80}(senior leader|decision[- ]maker|executive|business partner|client|vendor)/i, v: (p) => yn(p.autoApply.conflict), dflt: 'No' },
    { key: 'heardFrom', re: /how did you (hear|learn|find out) about|where did you (hear|find|see|learn) about|how did you find (this|the|our) (job|role|position|opening)|referral source|source of (your )?application/i, v: (p) => p.autoApply.heardFrom, dflt: 'Job board' },
    { key: 'years', re: /years of (professional |relevant |total )?experience|how many years/i, v: (p) => p.personal.yearsExperience },
    { key: 'salary', re: /salary|compensation|pay expectation|desired pay|expected pay/i, v: (p) => p.salary.min ? `${p.salary.min}${p.salary.max ? ' - ' + p.salary.max : ''}` : '' },
    { key: 'sponsorship', re: /sponsor/i, v: (p) => yn(p.autoApply.requireSponsorship) },
    { key: 'workAuth', re: /authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible|able)|eligible to work|right to work/i, v: (p) => yn(p.autoApply.workAuthorized) },
    { key: 'relocate', re: /relocat/i, v: (p) => yn(p.willingToRelocate) },
    { key: 'hispanic', re: /hispanic|latin[oax]/i, v: (p) => p.autoApply.eeo.hispanic },
    { key: 'race', re: /\brace\b|ethnic/i, v: (p) => p.autoApply.eeo.race },
    { key: 'gender', re: /gender|\bsex\b/i, v: (p) => p.autoApply.eeo.gender },
    { key: 'veteran', re: /veteran|military/i, v: (p) => p.autoApply.eeo.veteran },
    { key: 'disability', re: /disabilit/i, v: (p) => p.autoApply.eeo.disability },
    { key: 'pronouns', re: /pronoun/i, v: (p) => p.autoApply.eeo.pronouns },
    { key: 'notice', re: /notice period/i, v: (p) => p.autoApply.noticePeriod },
    { key: 'startDate', re: /start date|available to start|earliest start|when can you start/i, v: (p) => p.autoApply.earliestStart },
    { key: 'coverLetter', re: /cover letter/i, v: (p) => p.autoApply.coverLetterTemplate, textarea: true },
    { key: 'firstName', re: /(first|given|preferred)[\s_-]*name|^fname$/i, v: (p) => p.personal.firstName },
    { key: 'lastName', re: /(last|family|sur)[\s_-]*name|^lname$/i, v: (p) => p.personal.lastName },
    { key: 'fullName', re: /^(full[\s_-]*)?name$|your name|legal name|full name/i, v: (p) => [p.personal.firstName, p.personal.lastName].filter(Boolean).join(' ') },
    { key: 'email', re: /e-?mail/i, v: (p) => p.personal.email },
    { key: 'phoneType', re: /phone.{0,12}(device|type)|device type/i, v: () => 'Mobile' },
    { key: 'phone', re: /phone|mobile|cell|telephone/i, v: (p) => p.personal.phone },
    { key: 'linkedin', re: /linked\s?in/i, v: (p) => p.personal.linkedin },
    { key: 'github', re: /git\s?hub/i, v: (p) => p.personal.github },
    { key: 'website', re: /website|portfolio|personal (site|url)|^url$/i, v: (p) => p.personal.website },
    { key: 'zip', re: /zip|postal/i, v: (p) => p.personal.zip },
    { key: 'city', re: /\bcity\b|town/i, v: (p) => p.personal.city },
    { key: 'state', re: /\bstate\b|province|region/i, v: (p) => p.personal.state },
    { key: 'country', re: /\bcountry\b/i, v: (p) => p.personal.country },
    { key: 'location', re: /^(current )?location$|where are you (located|based)/i, v: (p) => [p.personal.city, p.personal.state].filter(Boolean).join(', ') },
    { key: 'address', re: /address( line)? ?1?$|street/i, v: (p) => p.personal.address },
    { key: 'currentCompany', re: /current (company|employer)|^company$|employer name/i, v: (p) => p.personal.currentCompany || first(p.autoApply.experience).company },
    { key: 'currentTitle', re: /current (job )?title|^job title$|current (role|position)/i, v: (p) => p.personal.currentTitle || first(p.autoApply.experience).title },
    { key: 'school', re: /\b(school|university|college|institution)\b/i, v: (p) => first(p.autoApply.education).school },
    { key: 'degree', re: /degree|level of education|highest education/i, v: (p) => first(p.autoApply.education).degree },
    { key: 'major', re: /major|field of study|discipline|area of study/i, v: (p) => first(p.autoApply.education).field },
    { key: 'gradYear', re: /graduat/i, v: (p) => first(p.autoApply.education).endYear },
    { key: 'gpa', re: /\bgpa\b|grade point/i, v: (p) => first(p.autoApply.education).gpa },
  ];

  const ruleFor = (label) => RULES.find((r) => r.re.test(label));
  const ruleByKey = (key) => RULES.find((r) => r.key === key);

  AJP.FIELD_RULES = RULES;
  AJP.fieldRules = { RULES, ruleFor, ruleByKey, yn, namedCompanies, previouslyEmployed };
})();
