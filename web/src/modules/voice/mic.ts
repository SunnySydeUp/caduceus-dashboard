// The microphone (M7 #07), free of React: whether this page may ask for it, what a refusal means and how to turn it back on. The browser asks for
// permission only when `getUserMedia` is first called, which the page does on the first press of the mic and never before.

export interface MicEnvironment {
  /** `window.isSecureContext`: the browser lets only a secure page (https, or localhost) ask for the microphone. */
  secure: boolean;
  hasMediaDevices: boolean;
  hasRecorder: boolean;
}

export type MicSupport = { ok: true } | { ok: false; reason: 'insecure' | 'unsupported'; message: string };

export function micSupport(environment: MicEnvironment): MicSupport {
  if (!environment.secure) {
    return {
      ok: false,
      reason: 'insecure',
      message: 'Browsers only let a secure page use the microphone. Open Caduceus over https (the Tailscale address) or on localhost, and this works. Typing is not affected.',
    };
  }
  if (!environment.hasMediaDevices || !environment.hasRecorder) {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot record audio, so the microphone is not offered. Typing is not affected.' };
  }
  return { ok: true };
}

/** How to allow the microphone again in the browser the user agent names. */
export function reEnableSteps(userAgent: string): string {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'On iPhone and iPad: open Settings › Safari › Microphone and choose Ask or Allow, or tap aA in the address bar › Website Settings › Microphone.';
  if (/Android/.test(userAgent)) return 'Tap the lock icon in the address bar › Permissions (or site settings) › Microphone › Allow.';
  if (/Firefox\//.test(userAgent)) return 'Click the permission icon in the address bar, remove the blocked Microphone entry, then press the microphone again.';
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent) && !/Chrome\/|Chromium\//.test(userAgent)) return 'In Safari › Settings › Websites › Microphone, set this site to Allow.';
  return 'Click the lock icon in the address bar › Site settings › Microphone › Allow, then press the microphone again.';
}

export interface MicProblem {
  kind: 'denied' | 'missing' | 'busy' | 'other';
  message: string;
}

/** What `getUserMedia`'s failure means, in words that say what to do. */
export function describeMicError(error: unknown, userAgent: string): MicProblem {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { kind: 'denied', message: `The microphone is blocked for Caduceus, so nothing was recorded. ${reEnableSteps(userAgent)} You can type in the meantime.` };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'missing', message: 'No microphone was found on this device. You can type instead.' };
  if (name === 'NotReadableError' || name === 'AbortError') return { kind: 'busy', message: 'The microphone is in use by another app, or could not start. Close the other app and try again, or type instead.' };
  return { kind: 'other', message: 'The microphone could not start. You can type instead.' };
}
