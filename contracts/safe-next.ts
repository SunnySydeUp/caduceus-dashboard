// Where a sign-in may send the owner next (`?next=`): a path on this origin, and nothing else. Shared by the web app's sign-in screen and the server's
// OIDC routes, which both put the value in an address the browser then follows.

/** A character a URL parser drops or reads differently (a tab or a new line inside `//`, a backslash for a slash): none belongs in a path. */
// eslint-disable-next-line no-control-regex
const NOT_IN_A_PATH = /[\u0000-\u001f\u007f\\]/;

/** `next` when it is a path on `origin` (parsed the way a browser does, so that what it strips cannot turn it into another site), else `/`. */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next || !next.startsWith('/') || NOT_IN_A_PATH.test(next)) return '/';
  try {
    const url = new URL(next, origin);
    return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
