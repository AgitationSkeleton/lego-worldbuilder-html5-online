// The bitmaps' PNGs (8-bit RGBA, as tools/build_library.py writes them), decoded here
// rather than by the browser, whenever their exact pixels are needed: to take a colour
// out (background transparent, matte), to colour them, to test a click on them, and for
// Lingo's image objects.  A browser's canvas cannot be trusted to give its pixels back as
// they were put in: some (Brave, against fingerprinting) change them a little on every
// read, and a white that is no longer quite white is not taken out.
//
// inflate() is RFC 1951's, for the zlib stream in a PNG's IDAT chunks.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// A canonical Huffman code from code lengths: {counts, symbols}, for decode().
function huffman(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s;
  return { counts, symbols };
}

let FIXED_LIT = null, FIXED_DIST = null;
function fixedCodes() {
  if (!FIXED_LIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED_LIT = huffman(l);
    FIXED_DIST = huffman(new Uint8Array(30).fill(5));
  }
}

export function inflate(src, sizeHint) {
  let pos = 0, bit = 0, bits = 0;
  let out = new Uint8Array(sizeHint || src.length * 4);
  let n = 0;
  const need = (k) => {
    if (n + k <= out.length) return;
    const o = new Uint8Array(Math.max(out.length * 2, n + k));
    o.set(out.subarray(0, n));
    out = o;
  };
  const getBits = (k) => {
    while (bits < k) {
      if (pos >= src.length) throw new Error('inflate: out of data');
      bit |= src[pos++] << bits;
      bits += 8;
    }
    const v = bit & ((1 << k) - 1);
    bit >>>= k;
    bits -= k;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= getBits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  for (;;) {
    const last = getBits(1);
    const type = getBits(2);
    if (type === 0) {
      bit = 0; bits = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      need(len);
      out.set(src.subarray(pos, pos + len), n);
      n += len;
      pos += len;
    } else {
      let lit, dist;
      if (type === 1) {
        fixedCodes();
        lit = FIXED_LIT; dist = FIXED_DIST;
      } else if (type === 2) {
        const hlit = getBits(5) + 257, hdist = getBits(5) + 1, hclen = getBits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = getBits(3);
        const clh = huffman(cl);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const sym = decode(clh);
          if (sym < 16) lens[i++] = sym;
          else {
            let rep, val = 0;
            if (sym === 16) { val = lens[i - 1]; rep = 3 + getBits(2); }
            else if (sym === 17) rep = 3 + getBits(3);
            else rep = 11 + getBits(7);
            lens.fill(val, i, i + rep);
            i += rep;
          }
        }
        lit = huffman(lens.subarray(0, hlit));
        dist = huffman(lens.subarray(hlit));
      } else {
        throw new Error('inflate: bad block type');
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          need(1);
          out[n++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          const len = LEN_BASE[li] + getBits(LEN_EXTRA[li]);
          const di = decode(dist);
          const d = DIST_BASE[di] + getBits(DIST_EXTRA[di]);
          need(len);
          for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
        }
      }
    }
    if (last) break;
  }
  return out.subarray(0, n);
}

// An 8-bit RGBA PNG's pixels: {width, height, data} (RGBA, row by row).
export function decodePNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  let o = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  let total = 0;
  while (o + 8 <= b.length) {
    const len = u32(o);
    const kind = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const body = b.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      width = u32(o + 8); height = u32(o + 12); depth = body[8]; type = body[9]; interlace = body[12];
    } else if (kind === 'IDAT') {
      idat.push(body);
      total += len;
    } else if (kind === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  if (depth !== 8 || type !== 6 || interlace) throw new Error('png: only 8-bit RGBA, not interlaced');
  const z = new Uint8Array(total);
  let p = 0;
  for (const c of idat) { z.set(c, p); p += c.length; }
  const stride = width * 4;
  const raw = inflate(z.subarray(2), (stride + 1) * height);   // (after zlib's two-byte header)
  const data = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    const at = y * stride, up = at - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[row + x];
      const a = x >= 4 ? data[at + x - 4] : 0;
      const c = y > 0 && x >= 4 ? data[up + x - 4] : 0;
      const bb = y > 0 ? data[up + x] : 0;
      let r;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + bb; break;
        case 3: r = v + ((a + bb) >> 1); break;
        case 4: {
          const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
          break;
        }
        default: throw new Error('png: bad filter');
      }
      data[at + x] = r & 255;
    }
  }
  return { width, height, data };
}
