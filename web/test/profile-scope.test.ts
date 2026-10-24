import { describe, expect, test } from 'vitest';
import { chooseProfile, effectiveProfile, profileScope, scopeMode, withProfile, type DeviceStore } from '../src/profile-scope.ts';
import { todayModule } from '../src/modules/today/index.ts';

const profiles = ['default', 'coder', 'writer'];

describe('effective profile (information architecture §6)', () => {
  test('the URL wins over the device last choice, which wins over the Hermes default', () => {
    expect(effectiveProfile({ urlProfile: 'writer', deviceChoice: 'coder', hermesDefault: 'default', profiles })).toEqual({ name: 'writer', source: 'url' });
    expect(effectiveProfile({ urlProfile: undefined, deviceChoice: 'coder', hermesDefault: 'default', profiles })).toEqual({ name: 'coder', source: 'device' });
    expect(effectiveProfile({ urlProfile: undefined, deviceChoice: undefined, hermesDefault: 'default', profiles })).toEqual({ name: 'default', source: 'hermes' });
  });

  test('a profile Hermes no longer has is ignored, and the URL is trusted while the profiles load', () => {
    expect(effectiveProfile({ urlProfile: 'deleted', deviceChoice: 'coder', hermesDefault: 'default', profiles })).toEqual({ name: 'coder', source: 'device' });
    expect(effectiveProfile({ urlProfile: 'deleted', deviceChoice: 'gone', hermesDefault: 'default', profiles })).toEqual({ name: 'default', source: 'hermes' });
    expect(effectiveProfile({ urlProfile: 'writer', deviceChoice: undefined, hermesDefault: 'default', profiles: undefined })).toEqual({ name: 'writer', source: 'url' });
  });
});

describe('profile scope of a screen', () => {
  const effective = (urlProfile: string | undefined) => effectiveProfile({ urlProfile, deviceChoice: 'coder', hermesDefault: 'default', profiles });

  test('a cross-profile screen shows All profiles until the URL names a profile; other screens use the effective profile', () => {
    expect(profileScope(effective(undefined), 'cross')).toBe('all');
    expect(profileScope(effective('deleted'), 'cross')).toBe('all');
    expect(profileScope(effective('writer'), 'cross')).toBe('writer');

    expect(profileScope(effective(undefined), 'one')).toBe('coder');
    expect(profileScope(effective('writer'), 'one')).toBe('writer');
    expect(profileScope(undefined, 'one')).toBeUndefined();
  });

  test('a screen locked to All profiles shows All profiles whatever the URL names, also before the profile is known', () => {
    expect(profileScope(effective('writer'), 'all')).toBe('all');
    expect(profileScope(undefined, 'all')).toBe('all');
  });

  test('a module locked to All profiles wins over cross-profile; Today is locked, and a route outside every module uses one profile', () => {
    expect(scopeMode({ allProfiles: true, crossProfile: true })).toBe('all');
    expect(scopeMode({ crossProfile: true })).toBe('cross');
    expect(scopeMode({})).toBe('one');
    expect(scopeMode(undefined)).toBe('one');
    expect(scopeMode(todayModule)).toBe('all');
  });
});

describe('choosing a profile', () => {
  /** This device's storage (localStorage in the browser). */
  function deviceStore(): DeviceStore & { saved: Map<string, string> } {
    const saved = new Map<string, string>();
    return { saved, getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => void saved.set(key, value) };
  }

  test('puts the profile in this tab URL and remembers it on this device, keeping the rest of the query', () => {
    const store = deviceStore();

    expect(chooseProfile({ name: 'coder', search: '?q=memory', store })).toBe('?q=memory&profile=coder');
    expect(chooseProfile({ name: 'writer', search: '?profile=coder&q=memory', store })).toBe('?profile=writer&q=memory');
    expect([...store.saved.values()]).toEqual(['writer']);
  });

  test('All profiles clears the URL parameter and leaves the device memory alone', () => {
    const store = deviceStore();
    chooseProfile({ name: 'coder', search: '', store });

    expect(chooseProfile({ name: 'all', search: '?profile=coder&q=memory', store })).toBe('?q=memory');
    expect([...store.saved.values()]).toEqual(['coder']);
  });
});

describe('links inside a tab', () => {
  test('carry the tab profile along, unless the link names its own', () => {
    expect(withProfile('/work/tasks', 'coder')).toBe('/work/tasks?profile=coder');
    expect(withProfile('/work/tasks?filter=failed', 'coder')).toBe('/work/tasks?filter=failed&profile=coder');
    expect(withProfile('/chat/new?profile=writer', 'coder')).toBe('/chat/new?profile=writer');
    expect(withProfile('/work/tasks', undefined)).toBe('/work/tasks');
  });
});
