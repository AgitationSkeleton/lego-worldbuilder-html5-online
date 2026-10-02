// A filter for what people write that others see: here, the names on the score tables.  The
// server (server/src/scores.js) stars out what it finds; the page's name box uses it too
// (src/online/scores.js).  It is CrystAlien Conflict Online's filter, unchanged.
//
// The words it looks for are not written here, nor anywhere in the repository: the table
// (profanity-table.js, made by CrystAlien Conflict Online's tools/make_profanity.mjs from a
// list kept elsewhere) holds a hash
// of each word as the filter writes it (below), so that what is looked for can be matched but
// not read.  (Hashes, not a secret: a word can still be tried against them.)
//
// How a word is found, however it is written:
// - letters of other alphabets and accented, fullwidth and styled ones as plain letters (NFKD,
//   and look-alikes such as Cyrillic а, е, о);
// - the stand-ins people use to get past a filter folded into one letter each (FOLD: 0 o;
//   1 ! | i; 3 e; 4 @ a; 5 $ s; 7 + t; 8 b; 9 g; v u; ph f; k q c) -- the table's words are
//   folded the same way, so any spelling of one meets any other (and the table has each word
//   with its l's as i's too, for a 1 written for an l).  Not l, y or z as i or s, nor ck as one
//   letter: "tilts", "dice", "kiss" and "cook" would meet words they are not;
// - punctuation inside a word left out (b.a.d, b-a-d), and letters spaced out (b a d) read as
//   one word;
// - a letter repeated any number of times, but not fewer than the word has it (a word with a
//   double letter is not the same word with a single one).
// A word is looked for anywhere in a word, at its start, or only as the whole of one, as the list
// says; and not inside the innocent words that hold one (a town's name, say), which the table
// has too, as hashes, as words to spare.
// A word found is starred out, the whole word it is in.

import { WORDS } from './profanity-table.js';

const LOOKALIKE = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ħ': 'h', 'ŧ': 't', 'ƒ': 'f',
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
};
const FOLD = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', 'v': 'u', 'k': 'c', 'q': 'c' };

// A word as the filter writes it: lower case, plain letters, stand-ins folded, punctuation gone.
// (A symbol that stands for a letter is kept at a word's start or end -- "$ave", "bo$$" -- other
// punctuation there is not: "boss!".)
export function fold(word) {
  let s = String(word).toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');
  s = Array.from(s, (c) => LOOKALIKE[c] || c).join('');
  s = s.replace(/^[^a-z0-9@$|+]+/, '').replace(/[^a-z0-9@$]+$/, '');
  s = Array.from(s, (c) => FOLD[c] || c).join('').replace(/[^a-z]/g, '');
  return s.replace(/p+h+/g, 'f');
}

// A folded word as its runs: each letter once (the skeleton) and how many times it came.
export function runs(folded) {
  let skeleton = '';
  const counts = [];
  for (const c of folded) {
    if (skeleton && skeleton[skeleton.length - 1] === c) counts[counts.length - 1]++;
    else { skeleton += c; counts.push(1); }
  }
  return { skeleton, counts };
}

// cyrb53, a 53-bit string hash, in base 36.
export function hash(s) {
  let h1 = 0xdeadbeef ^ 0x43414321, h2 = 0x41c6ce57 ^ 0x43414321;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Whether a folded word holds one of the table's words (not within one of its words to spare).
function holds(folded) {
  const r = runs(folded);
  const n = r.skeleton.length;
  const found = [];
  const spared = [];
  for (let i = 0; i < n; i++) {
    for (let len = 1; len <= Math.min(WORDS.max, n - i); len++) {
      const entries = WORDS.h[hash(r.skeleton.substr(i, len))];
      if (!entries) continue;
      for (const e of entries.split('|')) {
        const mode = e[0];
        if (mode === 'w' && (i !== 0 || i + len !== n)) continue;
        if (mode === 'p' && i !== 0) continue;
        let ok = e.length - 1 === len;
        for (let k = 0; k < len && ok; k++) ok = r.counts[i + k] >= Number(e[k + 1]);
        if (ok) (mode === 's' ? spared : found).push([i, i + len]);
      }
    }
  }
  return found.some(([a, b]) => !spared.some(([c, d]) => c <= a && b <= d));
}

// The text with every word that holds one of the table's starred out (spaces and punctuation
// around it as they were).
export function censor(text) {
  text = String(text == null ? '' : text);
  const parts = text.split(/(\s+)/);          // words at the even places, the spaces between
  const words = [];
  for (let i = 0; i < parts.length; i += 2) words.push({ i, f: fold(parts[i]) });
  const bad = new Set();
  for (const w of words) if (w.f && holds(w.f)) bad.add(w.i);
  // letters spaced out (a run of three or more one-letter words), read as one word
  for (let a = 0; a < words.length;) {
    let b = a;
    while (b < words.length && words[b].f.length === 1) b++;
    if (b - a >= 3 && holds(fold(words.slice(a, b).map((w) => w.f).join('')))) for (let k = a; k < b; k++) bad.add(words[k].i);
    a = Math.max(b, a + 1);
  }
  if (!bad.size) return text;
  return parts.map((p, i) => (bad.has(i) ? p.replace(/[^\s.,!?;:'"()]/g, '*') : p)).join('');
}

// Whether the text is clean (nothing in it would be starred out).
export function isClean(text) {
  return censor(text) === String(text == null ? '' : text);
}
