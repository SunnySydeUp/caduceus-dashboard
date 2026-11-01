import { describe, expect, it } from 'vitest';
import { plainFailure } from '../src/failure-words.ts';

describe('a failure in plain words', () => {
  it('says what a missing route means, and keeps the code as the detail', () => {
    expect(plainFailure('Hermes answered HTTP 404')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Hermes answered HTTP 404' });
    expect(plainFailure('Hermes answered HTTP 405.')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Hermes answered HTTP 405' });
  });

  it('says Hermes had a problem for any server error', () => {
    for (const status of [500, 502, 503]) expect(plainFailure(`Hermes answered HTTP ${status}`).message).toBe('Hermes had a problem answering');
  });

  it('names Caduceus when Caduceus is the one that answered', () => {
    expect(plainFailure('Caduceus answered HTTP 502.')).toEqual({ message: 'Caduceus had a problem answering', detail: 'Caduceus answered HTTP 502' });
  });

  it('reads a proxied request failure and a bare reason phrase the same way', () => {
    expect(plainFailure('GET /api/profiles: HTTP 404').message).toBe('Hermes doesn’t offer this yet');
    expect(plainFailure('Not Found')).toEqual({ message: 'Hermes doesn’t offer this yet', detail: 'Not Found' });
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
});
