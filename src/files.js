// A file the page fetches, by its address with ?v= and a hash of what is in it, as
// index.html names it (tools/stamp.py says why): a browser that kept an old copy fetches
// the new one when it changes. (The modules are named so by the page's import map.)
export function fileUrl(path, root) {
  const v = (window.__files || {})[path];
  return new URL(path + (v ? '?v=' + v : ''), root).href;
}
