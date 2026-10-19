import { expect, it } from 'vitest';
import { normalize, searchCorpus } from '../normalize';
import { MIN_QUERY_LENGTH } from '../types';
it('SEARCH-B01 normalises exactly as the stored corpus is: lower case, tashkeel and tatweel stripped, alef and alef maqsura folded', () => {
  expect(normalize('Ahmed')).toBe('ahmed');
  // Fatha, shadda, sukun and the tatweel go; U+0670 (superscript alef) goes with them.
  expect(normalize('مُحَمَّدْ')).toBe('محمد');
  expect(normalize('الـلـه')).toBe('الله');
  expect(normalize('رحمٰن')).toBe('رحمن');
  expect(normalize('أحمد إبراهيم آدم ٱلله')).toBe('احمد ابراهيم ادم الله');
  expect(normalize('مصطفى')).toBe('مصطفي');
  // Compatibility forms fold on both sides of the comparison.
  expect(normalize('ﬁle ﺍﺣﻤﺪ')).toBe('file احمد');
  expect(normalize('  spaced  ')).toBe('  spaced  ');
});
it('SEARCH-B01 the corpus starts with the normalised name, then a newline, then the rest joined by one space', () => {
  expect(searchCorpus('Budget Review', 'Q3 figures', null, undefined, '', 'Finance')).toBe(
    'budget review\nq3 figures finance',
  );
  expect(searchCorpus('أحمد')).toBe('احمد\n');
  // A prefix of the corpus is a prefix of the name and nothing else.
  expect(searchCorpus('Alpha', 'Alphabet').startsWith('alpha\n')).toBe(true);
  expect(searchCorpus('Beta', 'Alphabet').startsWith('alpha')).toBe(false);
});
it('SEARCH-B02 the minimum length is measured after normalisation', () => {
  expect(normalize('ً').trim().length).toBeLessThan(MIN_QUERY_LENGTH);
  expect(normalize('أب').trim().length).toBe(MIN_QUERY_LENGTH);
});
