import { describe, expect, it } from 'vitest';
import { plainFailure, plainFailureOf } from '../src/failure-words.ts';

describe('a failure in plain words', () => {
  it('says what a missing route means, keeps the code as the detail, and gives updating Hermes as the step in place of asking again', () => {
    expect(plainFailure('Hermes answered HTTP 404')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Hermes answered HTTP 404', next: 'Update Hermes to get it.' });
    expect(plainFailure('Hermes answered HTTP 405.')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Hermes answered HTTP 405', next: 'Update Hermes to get it.' });
    // Only Hermes's own missing route is fixed by a later Hermes; every other cause is one asking again can help.
    expect(plainFailure('Caduceus answered HTTP 404.').next).toBeUndefined();
    expect(plainFailure('Hermes answered HTTP 503').next).toBeUndefined();
  });

  it('says Hermes had a problem for a server error, and that it is not answering when Caduceus could not get an answer from it', () => {
    expect(plainFailure('Hermes answered HTTP 500').message).toBe('Hermes had a problem answering');
    for (const status of [502, 503]) expect(plainFailure(`Hermes answered HTTP ${status}`).message).toBe('Hermes isn’t answering');
    expect(plainFailure('Hermes did not answer.')).toEqual({ message: 'Hermes isn’t answering' });
  });

  it('reads the status Talk’s reads put in a sentence', () => {
    expect(plainFailure('Hermes answered 404 to /api/sessions')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Hermes answered 404 to /api/sessions', next: 'Update Hermes to get it.' });
  });

  it('tells a missing network from the Mac not answering, and never shows the browser’s words as the cause', () => {
    for (const raw of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(plainFailure(raw, true)).toEqual({ message: 'Can’t reach your Mac', detail: raw.replace(/\.$/, '') });
      expect(plainFailure(raw, false).message).toBe('You are offline');
    }
  });

  it('names Caduceus when Caduceus is the one that answered', () => {
    expect(plainFailure('Caduceus answered HTTP 502.')).toEqual({ message: 'Caduceus had a problem answering', detail: 'Caduceus answered HTTP 502' });
  });

  it('reads a proxied request failure and a bare reason phrase the same way', () => {
    expect(plainFailure('GET /api/profiles: HTTP 404').message).toBe('Hermes doesn’t offer this yet');
    expect(plainFailure('Not Found')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Not Found', next: 'Update Hermes to get it.' });
  });

  it('tells a slow answer, a refusal and a busy Hermes apart from a broken one', () => {
    expect(plainFailure('Hermes answered HTTP 504').message).toBe('Hermes took too long to answer');
    expect(plainFailure('Hermes answered HTTP 403').message).toBe('Hermes didn’t allow this');
    expect(plainFailure('Hermes answered HTTP 429').message).toBe('Hermes is busy right now');
  });

  it('leaves a sentence someone wrote for the owner as it is', () => {
    expect(plainFailure('Caduceus lost its live connection to what Hermes is waiting on.')).toEqual({ message: 'Caduceus lost its live connection to what Hermes is waiting on.' });
    expect(plainFailure('Hermes has no run abc (HTTP 404 from the list).')).toEqual({ message: 'Hermes has no run abc (HTTP 404 from the list).' });
  });

  it('reads a thrown error the same way as its message', () => {
    expect(plainFailureOf(new TypeError('Failed to fetch'), true).message).toBe('Can’t reach your Mac');
    expect(plainFailureOf('Not Found').message).toBe('Hermes doesn’t offer this yet');
  });
});
