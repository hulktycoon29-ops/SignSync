'use strict';
// Translation Service: maps normalized gloss tokens to target spoken languages.
// Dictionary-based (lexical) -- the module boundary allows a richer translator later.
const LANGS = {
  en: { name: 'English', tag: 'en-IN' },
  hi: { name: 'Hindi', tag: 'hi-IN' },
  mr: { name: 'Marathi', tag: 'mr-IN' },
};

const DICT = {
  HELLO: { en: 'Hello', hi: 'नमस्ते', mr: 'नमस्कार' },
  THANK_YOU: { en: 'Thank you', hi: 'धन्यवाद', mr: 'धन्यवाद' },
  YES: { en: 'Yes', hi: 'हाँ', mr: 'हो' },
  NO: { en: 'No', hi: 'नहीं', mr: 'नाही' },
  HELP: { en: 'Help', hi: 'मदद', mr: 'मदत' },
  WATER: { en: 'Water', hi: 'पानी', mr: 'पाणी' },
  FOOD: { en: 'Food', hi: 'खाना', mr: 'जेवण' },
  PLEASE: { en: 'Please', hi: 'कृपया', mr: 'कृपया' },
};

function translateGloss(gloss, lang) {
  if (!LANGS[lang]) throw new Error('Unsupported language: ' + lang);
  const entry = DICT[gloss];
  return entry ? entry[lang] : gloss.replace(/_/g, ' ').toLowerCase();
}

function translateSentence(glosses, lang) {
  return glosses.map((g) => translateGloss(g, lang)).join(' ');
}

module.exports = { LANGS, DICT, translateGloss, translateSentence };
