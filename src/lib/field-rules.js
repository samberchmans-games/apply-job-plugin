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

  // Order matters: more specific patterns first.
  const RULES = [
    // Question-style rules first: a long question can mention "country", "state" or "phone" (e.g. "authorized to work
    // in the country…?") and must not be answered with an address field. Then short field rules, most specific first.
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
    { key: 'school', re: /school|university|college|institution/i, v: (p) => first(p.autoApply.education).school },
    { key: 'degree', re: /degree|level of education|highest education/i, v: (p) => first(p.autoApply.education).degree },
    { key: 'major', re: /major|field of study|discipline|area of study/i, v: (p) => first(p.autoApply.education).field },
    { key: 'gradYear', re: /graduat/i, v: (p) => first(p.autoApply.education).endYear },
    { key: 'gpa', re: /\bgpa\b|grade point/i, v: (p) => first(p.autoApply.education).gpa },
  ];

  const ruleFor = (label) => RULES.find((r) => r.re.test(label));
  const ruleByKey = (key) => RULES.find((r) => r.key === key);

  AJP.FIELD_RULES = RULES;
  AJP.fieldRules = { RULES, ruleFor, ruleByKey, yn };
})();
