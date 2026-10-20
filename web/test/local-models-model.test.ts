import { describe, expect, test } from 'vitest';
import { jobLine, parseJobs, pauseRequest, resumeRequest } from '../src/modules/models/local-models.ts';

// Hermes's job bodies, as `hermes_cli/web_routers/local_models.py` makes them (`_job`, `_job_view`).
const running = { job_id: 'a1', kind: 'model-download', target: 'Qwen3.8 27B (UD-Q4_K_M)', model_id: 'qwen3.8-27b', status: 'running', phase: 'downloading', detail: 'Qwen3.8 27B — 17.9 GB', total_bytes: 19_200_000_000, done_bytes: 7_680_000_000, started_at: 1_790_000_000.5, error: null, percent: 40 };

describe('a download that can be paused (Hermes 0.22)', () => {
  test('a paused download is paused, not running; what Hermes allows is read from it, and the line says it is paused', () => {
    const [paused, pausing, going] = parseJobs({
      jobs: [
        { ...running, job_id: 'p1', status: 'paused', can_pause: false, can_resume: true, pause_requested: false },
        { ...running, job_id: 'p2', can_pause: false, can_resume: false, pause_requested: true },
        { ...running, job_id: 'p3', can_pause: true, can_resume: false, pause_requested: false },
      ],
    });
    expect(paused).toMatchObject({ status: 'paused', canResume: true, canPause: false });
    expect(jobLine(paused)).toBe('Paused · 7.2 GB of 17.9 GB · 40%');
    expect(pausing).toMatchObject({ status: 'running', pausing: true, canPause: false });
    expect(jobLine(pausing)).toBe('Pausing · 7.2 GB of 17.9 GB · 40%');
    expect(going).toMatchObject({ status: 'running', canPause: true, pausing: false });
    // A Hermes that does not say (before 0.22) offers neither.
    expect(parseJobs({ jobs: [running] })[0]).toMatchObject({ canPause: false, canResume: false });
  });

  test('pausing and resuming name the job Hermes gave', () => {
    expect(pauseRequest('a1')).toEqual({ method: 'POST', path: '/api/local-models/download/pause', body: { job_id: 'a1' } });
    expect(resumeRequest('a1')).toEqual({ method: 'POST', path: '/api/local-models/download/resume', body: { job_id: 'a1' } });
  });
});

describe('jobs', () => {
  test('a running download says how far it is in the words of the screen; a job that does not know its size says what it is doing', () => {
    const [job] = parseJobs({ jobs: [running] });
    expect(job).toMatchObject({ id: 'a1', status: 'running', percent: 40, doneBytes: 7_680_000_000, totalBytes: 19_200_000_000 });
    expect(jobLine(job)).toBe('7.2 GB of 17.9 GB · 40%');
    const [unsized] = parseJobs({ jobs: [{ ...running, total_bytes: null, done_bytes: 0, percent: undefined, phase: 'starting-server', detail: 'Starting the local server' }] });
    expect(jobLine(unsized)).toBe('Starting the local server');
  });

  test('a job that failed carries Hermes\'s reason; a finished one reads as done; an unknown status is still running, never lost', () => {
    const [failed, done, odd] = parseJobs({
      jobs: [
        { ...running, job_id: 'b2', status: 'error', error: 'download incomplete (4096 of 65536 bytes)' },
        { ...running, job_id: 'c3', status: 'done', phase: 'done', detail: 'Qwen3.8 27B ready', percent: 100 },
        { ...running, job_id: 'd4', status: 'something-new' },
        { kind: 'quickstart' },
      ],
    });
    expect(failed).toMatchObject({ status: 'error', error: 'download incomplete (4096 of 65536 bytes)' });
    expect(jobLine(failed)).toBe('download incomplete (4096 of 65536 bytes)');
    expect(jobLine(done)).toBe('Qwen3.8 27B ready');
    expect(odd.status).toBe('running');
    expect(parseJobs({ jobs: [{ kind: 'quickstart' }] })).toEqual([]);
  });
});
