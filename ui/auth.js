// Auth helpers, kept apart from app.js so they can be unit-tested without a DOM.

/** Inside ADE the page is loaded from ade-plugin://<id>/ and the host proxy injects the Authorization header. */
export const EMBEDDED_PROTOCOL = 'ade-plugin:';

export function isEmbedded(protocol) {
  return protocol === EMBEDDED_PROTOCOL;
}

/** Request headers for /api/*: embedded → no Authorization (the host adds it); browser → the typed dashboard token. */
export function apiHeaders({ protocol, token, hasBody }) {
  const headers = {};
  if (!isEmbedded(protocol)) headers.Authorization = `Bearer ${token}`;
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}
