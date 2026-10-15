// Hash router: #/<view>[/<arg>]?<query>
// Keeping every piece of state in the URL makes views shareable and back/forward-friendly.

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = h.split('?');
  const [view = 'overview', ...rest] = pathPart.split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : null;
  const params = Object.fromEntries(new URLSearchParams(query));
  return { view: view || 'overview', arg, params };
}

export function link(view, params = {}, arg = null) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  }
  const qs = q.toString();
  return `#/${view}${arg != null ? '/' + encodeURIComponent(arg) : ''}${qs ? '?' + qs : ''}`;
}

/** Update the URL without triggering a hashchange (used while typing in filters). */
export function replaceParams(view, params, arg = null) {
  history.replaceState(null, '', link(view, params, arg));
}

/** Filter keys used by the tests view — carried into detail links so "back" restores them. */
export const FILTER_KEYS = ['status', 'project', 'file', 'tag', 'q', 'sort', 'dir', 'group'];
export function pickFilters(params) {
  const out = {};
  for (const k of FILTER_KEYS) if (params[k]) out[k] = params[k];
  return out;
}
