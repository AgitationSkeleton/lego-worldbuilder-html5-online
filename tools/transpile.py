"""Translate the movies' Lingo (as decompiled by ProjectorRays) into JavaScript.

    python tools/transpile.py

writes src/games/<game>/scripts.js for each game.  The translation is line for line:
each handler becomes a JavaScript function, and every operation whose meaning differs
between the two languages goes through the runtime in src/director/lingo.js (integer
division, 1-based lists, case-insensitive names and comparisons, Lingo's own string
chunks).  Lingo names are case-insensitive, so locals, properties, globals and handler
names are all written in lower case.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

from lingo.parse import parse  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work')
GAMES = {'wb1': 'worldbuilder', 'wb2': 'worldbuilder2'}

JS_RESERVED = set('''break case catch class const continue debugger default delete do else enum export
extends false finally for function if import in instanceof new null return super switch this throw
true try typeof var void while with yield let static implements interface package private protected
public await arguments eval undefined nan infinity'''.split())

BINOPS = {'+': 'add', '-': 'sub', '*': 'mul', '/': 'div', 'mod': 'mod', '&': 'cat', '&&': 'cats',
          '=': 'eq', '<>': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', 'and': 'and',
          'or': 'or', 'contains': 'contains', 'starts': 'starts'}

# Built-in functions that never hand their work to an object's own handler: called directly.
PURE_BUILTINS = set('''voidp integer float string symbol point rect rgb member sprite sound random
abs sqrt min max script castlib list value chars offset length chartonum numtochar ilk objectp
listp stringp symbolp integerp floatp nothing cursor go updatestage puppetsound puppetsprite
image color paletteindex power sin cos atan bitand bitor bitxor bitnot getpref setpref alert halt
quit marker label rollover field param new duplicate timeout startTimer starttimer beep
externalparamvalue externalparamname externalparamcount gotonetpage gotoneturl netdone netabort
getnettext neterror nettextresult preloadnetthing frameready mediaready inflate union intersect
inside map xtra'''.split())

SCRIPT_KINDS = {'MovieScript': 'movie', 'BehaviorScript': 'score', 'ParentScript': 'parent',
                'CastScript': 'member'}


def jsname(n):
    n = n.lower()
    if n in JS_RESERVED or n.startswith('$'):
        return n + '_'
    return n


class Gen:
    def __init__(self, script_id, script, all_movie_handlers):
        self.sid = script_id
        self.script = script
        self.props = {p.lower() for p in script['props']}
        self.script_globals = {g.lower() for g in script['globals']}
        self.syms = {}
        self.floats = {}
        self.movie_handlers = all_movie_handlers
        self.own_handlers = {h['name'].lower() for h in script['handlers']}
        self.tmp = 0

    # ----- names -----
    def sym(self, name):
        key = name.lower()
        if key not in self.syms:
            self.syms[key] = (name, '$s_' + re.sub(r'\W', '_', key))
        return self.syms[key][1]

    def flt(self, v):
        if v not in self.floats:
            self.floats[v] = '$f%d' % len(self.floats)
        return self.floats[v]

    def newtmp(self):
        self.tmp += 1
        return '$t%d' % self.tmp

    def var(self, name):
        n = name.lower()
        if n in self.globals:
            return '$G.' + jsname(n)
        if n in self.params or n in self.locals:
            return jsname(n)
        if n in self.props:
            return 'this.$.' + jsname(n)
        self.locals.add(n)
        return jsname(n)

    # ----- expressions -----
    def e(self, x):
        t = x[0]
        if t == 'int':
            return str(x[1]) if x[1] >= 0 else '(%d)' % x[1]
        if t == 'float':
            return self.flt(x[1])
        if t == 'str':
            return json.dumps(x[1])
        if t == 'sym':
            return self.sym(x[1])
        if t == 'void':
            return 'undefined'
        if t == 'const':
            return '$L.PI'
        if t == 'list':
            return '$L.list([%s])' % ', '.join(self.e(a) for a in x[1])
        if t == 'plist':
            return '$L.plist([%s])' % ', '.join('%s, %s' % (self.e(k), self.e(v)) for k, v in x[1])
        if t == 'var':
            return self.var(x[1])
        if t == 'the':
            p = x[1].lower()
            if p == 'paramcount':
                return 'arguments.length'
            return '$R.the(%s)' % json.dumps(p)
        if t == 'theof':
            p = x[1].lower()
            if p.startswith('number of '):
                return '$R.theNumberOf(%s, %s)' % (json.dumps(p[10:]), self.e(x[2]))
            return '$L.gp(%s, %s)' % (self.e(x[2]), json.dumps(p))
        if t == 'count':
            return '$L.chunkCount(%s, %s)' % (self.e(x[2]), json.dumps(x[1]))
        if t == 'last':
            return '$L.lastChunk(%s, %s)' % (self.e(x[2]), json.dumps(x[1]))
        if t == 'chunk':
            return '$L.chunk(%s, %s, %s, %s)' % (self.e(x[4]), json.dumps(x[1]), self.e(x[2]),
                                                 self.e(x[3]) if x[3] else '0')
        if t == 'member':
            kind = x[1]
            fn = {'member': 'member', 'cast': 'member', 'script': 'script', 'castlib': 'castlib',
                  'window': 'window'}[kind]
            args = [self.e(x[2])] + ([self.e(x[3])] if x[3] else [])
            return '$B.%s(%s)' % (fn, ', '.join(args))
        if t == 'call':
            return self.call(x[1], x[2])
        if t == 'mcall':
            args = [self.e(x[1]), json.dumps(x[2].lower())] + [self.e(a) for a in x[3]]
            return '$L.mc(%s)' % ', '.join(args)
        if t == 'prop':
            return '$L.gp(%s, %s)' % (self.e(x[1]), json.dumps(x[2].lower()))
        if t == 'index':
            return '$L.gi(%s, %s)' % (self.e(x[1]), self.e(x[2]))
        if t == 'pindex':
            args = [self.e(x[1]), json.dumps(x[2].lower()), self.e(x[3])]
            if x[4] is not None:
                args.append(self.e(x[4]))
            return '$L.gpi(%s)' % ', '.join(args)
        if t == 'neg':
            return '$L.neg(%s)' % self.e(x[1])
        if t == 'not':
            return '$L.not(%s)' % self.e(x[1])
        if t == 'bin':
            return '$L.%s(%s, %s)' % (BINOPS[x[1]], self.e(x[2]), self.e(x[3]))
        if t == 'intersects':
            return '$R.spriteIntersects(%s, %s)' % (self.e(x[1]), self.e(x[2]))
        if t == 'within':
            return '$R.spriteWithin(%s, %s)' % (self.e(x[1]), self.e(x[2]))
        raise ValueError('expression %r' % (x,))

    def call(self, name, args):
        n = name.lower()
        a = [self.e(v) for v in args]
        if n == 'param':
            return 'arguments[$L.toInt(%s) - 1]' % a[0]
        if n in PURE_BUILTINS and n not in self.movie_handlers and n not in self.own_handlers:
            return '$B.%s(%s)' % (jsname(n), ', '.join(a))
        return '$R.call(this, %s, %s%s)' % (self.sid, json.dumps(n), ''.join(', ' + v for v in a))

    # ----- assignment -----
    def assign(self, target, value_js, ind):
        t = target[0]
        if t == 'var':
            return ind + '%s = %s;' % (self.var(target[1]), value_js)
        if t == 'the':
            return ind + '$R.setThe(%s, %s);' % (json.dumps(target[1].lower()), value_js)
        if t in ('prop', 'theof'):
            obj = target[1] if t == 'prop' else target[2]
            name = target[2] if t == 'prop' else target[1]
            return ind + '$L.sp(%s, %s, %s);' % (self.e(obj), json.dumps(name.lower()), value_js)
        if t == 'index':
            return ind + '$L.si(%s, %s, %s);' % (self.e(target[1]), self.e(target[2]), value_js)
        if t == 'pindex':
            if target[2].lower() in ('char', 'word', 'item', 'line'):
                ch = ('chunk', target[2].lower(), target[3], target[4], target[1])
                return self.assign_chunk(ch, value_js, 'into', ind)
            return ind + '$L.spi(%s, %s, %s, %s);' % (self.e(target[1]), json.dumps(target[2].lower()),
                                                       self.e(target[3]), value_js)
        if t == 'chunk':
            return self.assign_chunk(target, value_js, 'into', ind)
        if t == 'call' and target[1].lower() == 'field':
            return ind + '$L.sp(%s, "text", %s);' % (self.e(target), value_js)
        if t == 'member':
            return ind + '$L.sp(%s, "text", %s);' % (self.e(target), value_js)
        raise ValueError('cannot assign to %r' % (target,))

    def assign_chunk(self, ch, value_js, mode, ind):
        """put <value> into|after|before <chunk>: rebuild the string the chunk is in."""
        _, ctype, first, last, base = ch
        base_js = self.e(base)
        new = '$L.putChunk(%s, %s, %s, %s, %s, %s)' % (base_js, json.dumps(ctype), self.e(first),
                                                         self.e(last) if last else '0', value_js,
                                                         json.dumps(mode))
        return self.assign_into(base, new, ind)

    def assign_into(self, target, value_js, ind):
        if target[0] == 'chunk':
            return self.assign_chunk(target, value_js, 'into', ind)
        if target[0] == 'pindex' and target[2].lower() in ('char', 'word', 'item', 'line'):
            return self.assign_chunk(('chunk', target[2].lower(), target[3], target[4], target[1]),
                                     value_js, 'into', ind)
        return self.assign(target, value_js, ind)

    def delete_chunk(self, ch, ind):
        if ch[0] == 'pindex':
            ch = ('chunk', ch[2].lower(), ch[3], ch[4], ch[1])
        if ch[0] != 'chunk':
            raise ValueError('delete of %r' % (ch,))
        _, ctype, first, last, base = ch
        new = '$L.deleteChunk(%s, %s, %s, %s)' % (self.e(base), json.dumps(ctype), self.e(first),
                                                  self.e(last) if last else '0')
        return self.assign_into(base, new, ind)

    # ----- statements -----
    def block(self, stmts, ind):
        out = []
        for s in stmts:
            out.append(self.stmt(s, ind))
        return '\n'.join(o for o in out if o)

    def stmt(self, s, ind):
        t = s[0]
        if t == 'assign':
            return self.assign(s[1], self.e(s[2]), ind)
        if t == 'put':
            return ind + '$R.put(%s);' % self.e(s[1])
        if t == 'putinto':
            mode, val, target = s[1], s[2], s[3]
            if target[0] == 'chunk' or (target[0] == 'pindex' and target[2].lower() in ('char', 'word', 'item', 'line')):
                if target[0] == 'pindex':
                    target = ('chunk', target[2].lower(), target[3], target[4], target[1])
                return self.assign_chunk(target, self.e(val), mode, ind)
            if mode == 'into':
                return self.assign(target, self.e(val), ind)
            if mode == 'after':
                return self.assign(target, '$L.cat(%s, %s)' % (self.e(target), self.e(val)), ind)
            return self.assign(target, '$L.cat(%s, %s)' % (self.e(val), self.e(target)), ind)
        if t == 'delete':
            return self.delete_chunk(s[1], ind)
        if t == 'hilite':
            return ind + '/* hilite */'
        if t in ('call', 'mcall'):
            if t == 'call' and s[1].lower() == 'return':
                return ind + 'return %s;' % (self.e(s[2][0]) if s[2] else '')
            return ind + self.e(s) + ';'
        if t == 'return':
            return ind + ('return %s;' % self.e(s[1]) if s[1] is not None else 'return;')
        if t == 'exit':
            return ind + 'return;'
        if t == 'exitrepeat':
            return ind + 'break;'
        if t == 'nextrepeat':
            return ind + 'continue;'
        if t == 'global':
            return ''
        if t == 'if':
            out = ind + 'if ($L.t(%s)) {\n' % self.e(s[1])
            out += self.block(s[2], ind + '  ')
            if s[3]:
                if len(s[3]) == 1 and s[3][0][0] == 'if':
                    out += '\n' + ind + '} else ' + self.stmt(s[3][0], ind).lstrip()
                    return out
                out += '\n' + ind + '} else {\n' + self.block(s[3], ind + '  ')
            return out + '\n' + ind + '}'
        if t == 'while':
            # A loop that never ends would hang the page: after five million passes it is
            # stopped as a script error.
            g = self.newtmp()
            return ind + 'for (let %s = 0; $L.t(%s); %s++) {\n%s  if (%s > 5e6) $L.stuck();\n%s\n%s}' % (
                g, self.e(s[1]), g, ind, g, self.block(s[2], ind + '  '), ind)
        if t == 'repeatto':
            v = self.var(s[1])
            cmp = 'le' if s[4] else 'ge'
            step = 'add' if s[4] else 'sub'
            g = self.newtmp()
            return ind + 'for (let %s = (%s = %s, 0); $L.%s(%s, %s); %s = $L.%s(%s, 1)) {\n%s  if (++%s > 5e6) $L.stuck();\n%s\n%s}' % (
                g, v, self.e(s[2]), cmp, v, self.e(s[3]), v, step, v, ind, g, self.block(s[5], ind + '  '), ind)
        if t == 'repeatin':
            v = self.var(s[1])
            lst, n, i = self.newtmp(), self.newtmp(), self.newtmp()
            return ind + 'for (let %s = %s, %s = $L.count(%s), %s = 1; %s <= %s; %s++) {\n%s%s = $L.gi(%s, %s);\n%s\n%s}' % (
                lst, self.e(s[2]), n, lst, i, i, n, i, ind + '  ', v, lst, i, self.block(s[3], ind + '  '), ind)
        if t == 'case':
            tv = self.newtmp()
            out = ind + 'const %s = %s;\n' % (tv, self.e(s[1]))
            first = True
            for values, body in s[2]:
                cond = ' || '.join('$L.eqb(%s, %s)' % (tv, self.e(v)) for v in values)
                out += ind + ('if' if first else '} else if') + ' (%s) {\n%s\n' % (cond, self.block(body, ind + '  '))
                first = False
            if s[3] is not None:
                if first:
                    out += ind + '{\n%s\n' % self.block(s[3], ind + '  ')
                else:
                    out += ind + '} else {\n%s\n' % self.block(s[3], ind + '  ')
            if not first or s[3] is not None:
                out += ind + '}'
            return '{\n' + out + '\n' + ind[:-2] + '}' if False else ind + '{\n' + '\n'.join('  ' + l for l in out.split('\n')) + '\n' + ind + '}'
        if t == 'sound':
            return ind + '$R.soundCommand(%s%s);' % (json.dumps(s[1].lower()), ''.join(', ' + self.e(a) for a in s[2]))
        if t == 'play':
            return ind + '$R.playCommand(%s);' % json.dumps(' '.join(v for k, v in s[1]))
        raise ValueError('statement %r' % (s,))

    def handler(self, h):
        self.params = [p.lower() for p in h['params']]
        self.globals = set(self.script_globals)
        for st in walk(h['body']):
            if st[0] == 'global':
                self.globals |= {n.lower() for n in st[1]}
        self.locals = set()
        self.tmp = 0
        body = self.block(h['body'], '      ')
        decl = sorted(self.locals - set(self.params) - self.globals - self.props)
        params = ', '.join(jsname(p) for p in self.params)
        out = '    %s(%s) {\n' % (jsname(h['name'].lower()) if jsname(h['name'].lower()) == h['name'].lower() else json.dumps(h['name'].lower()), params)
        if decl:
            out += '      let %s;\n' % ', '.join(jsname(d) for d in decl)
        if body:
            out += body + '\n'
        out += '    },\n'
        return out


def walk(stmts):
    for s in stmts:
        yield s
        if s[0] == 'if':
            yield from walk(s[2])
            yield from walk(s[3])
        elif s[0] in ('while',):
            yield from walk(s[2])
        elif s[0] == 'repeatto':
            yield from walk(s[5])
        elif s[0] == 'repeatin':
            yield from walk(s[3])
        elif s[0] == 'case':
            for _, body in s[2]:
                yield from walk(body)
            if s[3]:
                yield from walk(s[3])


def fix_chunk_var_refs(text, lasm):
    """Correct a ProjectorRays 0.2.0 slip with Director 8 bytecode.

    A chunk of a local variable used as a target ("delete tmline.char[1]") compiles to
    pushint8 <n>, pushchunkvarref 5.  The n on the stack is the local's plain number, but
    getlocal and setlocal operands are that number times 8, and the decompiler names the
    local as if n were already multiplied: World Builder 2's map display manager came out
    as "delete i.char[1]", deleting from its loop counter, where the movie deletes from
    tmline.  The bytecode listing beside each script says which local it really is.
    """
    fixes = []
    locals_ = {}
    prev = ''
    for line in lasm.splitlines():
        if line.startswith('on '):
            locals_ = {}
        m = re.search(r'\b[gs]etlocal (\d+)\b.*?(?:<(\w+)>|\s(\w+) = )', line)
        if m:
            locals_[int(m.group(1))] = m.group(2) or m.group(3)
        m = re.search(r'pushchunkvarref 5 \.+ <(\w+)>', line)
        if m:
            n = re.search(r'push(?:int8|int16|zero)\s*(\d*)', prev)
            if n:
                k = int(n.group(1) or 0)
                right = locals_.get(k * 8)
                if right and right != m.group(1):
                    fixes.append((m.group(1), right))
        m = re.search(r'objcall \d+ \.+ (delete|put) (.*)$', line)
        if m and fixes and fixes[-1][0] in m.group(2):
            wrong, right = fixes[-1]
            stmt = m.group(1) + ' ' + m.group(2)
            fixed = re.sub(r'\b%s\b' % re.escape(wrong), right, stmt, count=1)
            text = text.replace(stmt, fixed, 1)
            fixes.pop()
        prev = line
    return text


# Changes made to the games' Lingo before it is translated: few, each asked for, each with
# its reason.  Keyed by (movie, cast, script name); each change is (old, new) text.
INFO_TOGGLE = [
    # The INFO button shows a unit's information bubble; in the original, pressing it again
    # slid the bubble in again from the right, and only the bubble's own Close button put
    # it away.  Here pressing INFO again for the same unit puts it away too.
    ('property ss, sloc, pObj, pPlan, pSlide\n', 'property ss, sloc, pObj, pPlan, pSlide, pShowing\n'),
    ('on hideAll me\n', 'on hideAll me\n  pShowing = VOID\n'),
    ('on hideInfo me\n', 'on hideInfo me\n  pShowing = VOID\n'),
    ('on showinfo me, uclass, uname\n',
     'on showinfo me, uclass, uname\n  if pShowing = uname then\n    me.hideInfo()\n    return \n  end if\n  pShowing = uname\n'),
]
FIXES = {
    ('worldbuilder', 'Internal', 'unit info bubble behavior'): INFO_TOGGLE,
    ('worldbuilder2', 'Internal', 'unit info bubble behavior'): INFO_TOGGLE,
}


def apply_fixes(movie, cast, name, text):
    for old, new in FIXES.get((movie, cast, name), []):
        if old not in text:
            raise SystemExit('fix for %s/%s/%s no longer applies: %r' % (movie, cast, name, old))
        text = text.replace(old, new, 1)
    return text


def load_scripts(movie):
    base = os.path.join(WORK, 'pr', movie, movie, 'casts')
    movie_json = None
    scripts = []
    for cast in sorted(os.listdir(base)):
        d = os.path.join(base, cast)
        for f in sorted(os.listdir(d)):
            if not f.endswith('.ls'):
                continue
            m = re.match(r'(\w+) (\d+)(?: - (.*))?\.ls$', f)
            kind, num, name = m.group(1), int(m.group(2)), m.group(3) or ''
            text = open(os.path.join(d, f), encoding='latin-1').read()
            lasm = os.path.join(d, f[:-3] + '.lasm')
            if os.path.exists(lasm):
                text = fix_chunk_var_refs(text, open(lasm, encoding='latin-1').read())
            text = apply_fixes(movie, cast, name, text.replace('\r\n', '\n'))
            scripts.append(dict(cast=cast, number=num, name=name, kind=SCRIPT_KINDS.get(kind, kind),
                                ast=parse(text, f), source=f))
    return scripts


def transpile(game, movie):
    movie_data = json.load(open(os.path.join(ROOT, 'data', game + '.json'), encoding='utf-8'))
    cast_numbers = {c['name']: i + 1 for i, c in enumerate(movie_data['casts'])}
    scripts = load_scripts(movie)
    movie_handlers = set()
    for s in scripts:
        if s['kind'] == 'movie':
            movie_handlers |= {h['name'].lower() for h in s['ast']['handlers']}
    out = ['// Generated by tools/transpile.py from the Lingo of %s.dcr, as ProjectorRays decompiled it.' % movie,
           '// Do not edit: run the tool again instead.',
           "import * as $L from '../../director/lingo.js';",
           '', 'let $R, $B, $G;', '']
    bodies = []
    all_syms = {}
    all_floats = {}
    for s in scripts:
        cl = cast_numbers[s['cast']]
        sid = 'S%d_%d' % (cl, s['number'])
        g = Gen(sid, s['ast'], movie_handlers)
        # floats and symbols are shared across the module
        g.syms = all_syms
        g.floats = all_floats
        hs = ''.join(g.handler(h) for h in s['ast']['handlers'])
        props = json.dumps([p.lower() for p in s['ast']['props']])
        bodies.append('// %s %d: %s (%s)\nconst %s = {\n  castLib: %d, member: %d, name: %s, type: %s,\n  props: %s,\n  handlers: {\n%s  },\n};\n' % (
            s['cast'], s['number'], s['name'], s['kind'], sid, cl, s['number'], json.dumps(s['name']),
            json.dumps(s['kind']), props, hs))
    for key, (orig, js) in sorted(all_syms.items()):
        out.append('const %s = $L.sym(%s);' % (js, json.dumps(orig)))
    for v, js in sorted(all_floats.items(), key=lambda kv: int(kv[1][2:])):
        out.append('const %s = $L.F(%r);' % (js, v))
    out.append('')
    out += bodies
    ids = ['S%d_%d' % (cast_numbers[s['cast']], s['number']) for s in scripts]
    out.append('export const scripts = [%s];' % ', '.join(ids))
    out.append('')
    out.append('export function bind(runtime) {')
    out.append('  $R = runtime;')
    out.append('  $B = runtime.builtins;')
    out.append('  $G = runtime.globals;')
    out.append('}')
    dest = os.path.join(ROOT, 'src', 'games', game)
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, 'scripts.js'), 'w', encoding='utf-8', newline='\n') as fp:
        fp.write('\n'.join(out) + '\n')
    print(game, len(scripts), 'scripts')


if __name__ == '__main__':
    for game, movie in GAMES.items():
        transpile(game, movie)
