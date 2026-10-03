// Director's sound channels, on Web Audio.  Each channel plays a member and then the
// members queued after it (setPlayList / queue), back to back, as the game's music is
// built from short pieces played one after another.

import { LList, LPropList, sym, toInt, num, str, LingoError } from './lingo.js';
import { Member, SoundMember } from './members.js';

export class SoundSystem {
  constructor(runtime) {
    this.runtime = runtime;
    this.ctx = null;
    this.channels = [];
    this.master = null;
    this.muted = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
    for (let i = 0; i <= 8; i++) this.channels.push(new SoundChannel(this, i));
  }
  channel(n) {
    n = toInt(n);
    while (this.channels.length <= n) this.channels.push(new SoundChannel(this, this.channels.length));
    return this.channels[Math.max(0, n)];
  }
  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  async decode(member, bytes) {
    if (!this.ctx) return;
    try {
      member.buffer = trimmed(this.ctx, await this.ctx.decodeAudioData(bytes), member.rec);
    } catch (e) {
      console.warn('could not decode sound', member.name, e);
    }
  }
  now() { return this.ctx ? this.ctx.currentTime : performance.now() / 1000; }
  // Called every tick: start what is queued, as close to the end of what plays as it can.
  pump() {
    for (const ch of this.channels) ch.pump();
  }
  stopAll() { for (const ch of this.channels) ch.stop(); }
}

// Shockwave Audio is MPEG audio, which decodes to more than the sound: the encoder's and
// the decoder's delay before it (576 + 529 samples for MPEG-2 Layer III, as every sound in
// the two games bears out) and padding to a whole frame after.  The sound is cut to the
// samples its header gives, so that the music's short pieces, played back to back, follow
// each other without a gap.
const MPEG_DELAY = 576 + 529;

function trimmed(ctx, buf, rec) {
  if (!rec || rec.format !== 'mp3' || !rec.samples || !rec.rate) return buf;
  const k = buf.sampleRate / rec.rate;
  const from = Math.round(MPEG_DELAY * k);
  const len = Math.min(Math.round(rec.samples * k), buf.length - from);
  if (len <= 0) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, from + len), c);
  return out;
}

class SoundChannel {
  constructor(sys, n) {
    this.sys = sys;
    this.n = n;
    this.queue = [];        // [{member, loopCount}]
    this.current = null;    // {member, node, gain, start, end, loopsLeft}
    this.next = null;       // scheduled to start when current ends
    this.volume = 255;
    this.pan = 0;
    this.gain = null;
    this.panner = null;
    this.fade = null;
    if (sys.ctx) {
      this.gain = sys.ctx.createGain();
      this.panner = sys.ctx.createStereoPanner ? sys.ctx.createStereoPanner() : null;
      if (this.panner) { this.gain.connect(this.panner); this.panner.connect(sys.master); } else this.gain.connect(sys.master);
    }
  }
  applyVolume() {
    if (this.gain) this.gain.gain.setValueAtTime(Math.max(0, Math.min(255, this.volume)) / 255, this.sys.ctx.currentTime);
  }
  memberOf(x) {
    if (x instanceof Member) return x;
    if (x === undefined) return null;
    const m = this.sys.runtime.member(x);
    return m instanceof SoundMember ? m : null;
  }
  entryOf(x) {
    if (x instanceof LPropList) {
      const get = (k) => { const i = x.find(sym(k)); return i < 0 ? undefined : x.v[i]; };
      const m = this.memberOf(get('member'));
      if (!m) return null;
      const lc = get('loopCount');
      // the part of the sound to play, in milliseconds (the music's pieces are cut so, to
      // keep two channels' pieces the same length)
      const st = get('startTime'), et = get('endTime');
      return { member: m, loopCount: lc === undefined ? 1 : toInt(lc),
        startTime: st === undefined ? 0 : Math.max(0, num(st)) / 1000, endTime: et === undefined ? null : num(et) / 1000 };
    }
    const m = this.memberOf(x);
    return m ? { member: m, loopCount: m.rec && m.rec.loop ? 0 : 1 } : null;
  }
  isBusy() { return !!(this.current && (this.current.end === Infinity || this.current.end > this.sys.now())); }
  start(entry, when) {
    const sys = this.sys;
    const m = entry.member;
    if (!sys.ctx || !m.buffer) {
      // nothing to hear: it still takes its time, so playlists move on
      const dur = m.buffer ? m.buffer.duration : 0.05;
      return { entry, node: null, start: when, end: when + dur, loopsLeft: 0 };
    }
    const node = sys.ctx.createBufferSource();
    node.buffer = m.buffer;
    const loops = entry.loopCount;
    const from = Math.min(entry.startTime || 0, m.buffer.duration);
    const to = entry.endTime === null || entry.endTime === undefined ? m.buffer.duration : Math.max(from, Math.min(entry.endTime, m.buffer.duration));
    const dur = Math.max(0.001, to - from);
    if (loops === 0 || loops > 1) {
      node.loop = true;
      node.loopStart = from;
      node.loopEnd = to;
    }
    node.connect(this.gain);
    node.start(when, from);
    const end = loops === 0 ? Infinity : when + dur * Math.max(1, loops);
    if (end !== Infinity) node.stop(end);
    return { entry, node, start: when, end };
  }
  playEntry(entry) {
    this.stopNodes();
    this.applyVolume();
    this.current = this.start(entry, this.sys.now());
  }
  pump() {
    const now = this.sys.now();
    if (this.fade) {
      const f = this.fade;
      const t = Math.min(1, (performance.now() - f.t0) / Math.max(1, f.ms));
      this.volume = f.from + (f.to - f.from) * t;
      this.applyVolume();
      if (t >= 1) this.fade = null;
    }
    if (this.current && this.current.end !== Infinity) {
      if (!this.next && this.queue.length && this.current.end - now < 0.3) {
        const entry = this.queue.shift();
        this.next = this.start(entry, Math.max(now, this.current.end));
      }
      if (now >= this.current.end) {
        this.current = this.next;
        this.next = null;
      }
    } else if (!this.current && this.queue.length && this.autoplay) {
      this.current = this.start(this.queue.shift(), now);
    }
  }
  stopNodes() {
    for (const c of [this.current, this.next]) {
      if (c && c.node) { try { c.node.stop(); } catch (e) { /* not started */ } c.node.disconnect(); }
    }
    this.current = null;
    this.next = null;
  }
  stop() {
    this.stopNodes();
    this.autoplay = false;
  }
  lgGet(name) {
    switch (name) {
      case 'volume': return Math.round(this.volume);
      case 'pan': return this.pan;
      case 'status': return this.isBusy() ? 3 : (this.queue.length ? 2 : 0);
      case 'member': return this.current ? this.current.entry.member : undefined;
      case 'elapsedtime': return this.current ? Math.max(0, Math.round((this.sys.now() - this.current.start) * 1000)) : 0;
      case 'loopcount': return this.current ? this.current.entry.loopCount : 0;
      case 'number': return this.n;
      case 'ilk': return sym('instance');
    }
    return undefined;
  }
  lgSet(name, v) {
    switch (name) {
      case 'volume': this.volume = Math.max(0, Math.min(255, num(v))); this.fade = null; this.applyVolume(); return;
      case 'pan':
        this.pan = num(v);
        if (this.panner) this.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, this.pan / 100)), this.sys.ctx.currentTime);
        return;
      case 'member': { const e = this.entryOf(v); if (e) this.playEntry(e); return; }
    }
  }
  lgCall(name, args) {
    switch (name) {
      case 'play': {
        if (args.length && args[0] !== undefined) {
          const e = this.entryOf(args[0]);
          if (e) this.playEntry(e);
          return;
        }
        if (!this.isBusy() && this.queue.length) {
          this.autoplay = true;
          this.playEntry(this.queue.shift());
        }
        this.autoplay = true;
        return;
      }
      case 'queue': {
        const e = this.entryOf(args[0]);
        if (e) this.queue.push(e);
        return;
      }
      case 'setplaylist': {
        this.queue = [];
        const l = args[0];
        if (l instanceof LList) for (const x of l.a) { const e = this.entryOf(x); if (e) this.queue.push(e); }
        return;
      }
      case 'getplaylist': {
        const out = new LList();
        for (const e of this.queue) {
          const p = new LPropList();
          p.k.push(sym('member'), sym('loopCount')); p.v.push(e.member, e.loopCount);
          out.a.push(p);
        }
        return out;
      }
      case 'stop': this.stop(); this.queue = []; return;
      case 'pause': this.stopNodes(); return;
      case 'rewind': if (this.current) this.playEntry(this.current.entry); return;
      case 'playnext': {
        this.stopNodes();
        if (this.queue.length) this.playEntry(this.queue.shift());
        return;
      }
      case 'breakloop': return;
      case 'isbusy': return this.isBusy() ? 1 : 0;
      case 'fadein': {
        const ms = args.length ? num(args[0]) : 1000;
        const to = args.length > 1 ? num(args[1]) : 255;
        this.volume = 0;
        this.fade = { from: 0, to, ms, t0: performance.now() };
        this.applyVolume();
        return;
      }
      case 'fadeout': {
        const ms = args.length ? num(args[0]) : 1000;
        this.fade = { from: this.volume, to: 0, ms, t0: performance.now() };
        return;
      }
      case 'fadeto': {
        this.fade = { from: this.volume, to: num(args[0]), ms: args.length > 1 ? num(args[1]) : 1000, t0: performance.now() };
        return;
      }
    }
    throw new LingoError('sound channel has no method ' + name);
  }
  lgIlk() { return 'instance'; }
  lgRepr() { return '<sound ' + this.n + '>'; }
}
