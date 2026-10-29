import { describe, expect, test } from 'vitest';
import type { AppModule } from '../src/app-registry.ts';
import { backAction, upTarget } from '../src/back-target.ts';
import type { RouteInfo } from '../src/shell/navigation.tsx';

const module = (desk: AppModule['desk'], path: string): AppModule => ({ id: path.slice(1), title: path.slice(1), desk, path }) as AppModule;
const route = (pathname: string, extra: Partial<RouteInfo> = {}): RouteInfo => ({ pathname, moduleId: undefined, title: undefined, parent: undefined, ...extra });

const work = module('work', '/work');
const talk = module('talk', '/chat');
const settings = module('control', '/settings');

describe('where "up" is', () => {
  test('a route that names a parent goes to it', () => {
    expect(upTarget(route('/work/tasks/t1', { parent: '/work/tasks' }), work)).toBe('/work/tasks');
  });

  test('without a parent, one level up inside the module; the module root is a top-level screen', () => {
    expect(upTarget(route('/work/runs/r1'), work)).toBe('/work/runs');
    expect(upTarget(route('/work'), work)).toBeNull();
  });

  test('the root of a Control module goes to Control, and Control itself has no up', () => {
    expect(upTarget(route('/settings'), settings)).toBe('/control');
    expect(upTarget(route('/control', { title: 'Control' }), undefined)).toBeNull();
  });

  test('a page outside every module goes home', () => {
    expect(upTarget(route('/nope'), undefined)).toBe('/');
  });

  test('a Talk thread goes to Today: the Talk list opens the latest thread again, so it would lead nowhere', () => {
    expect(upTarget(route('/chat/s1', { parent: '/chat' }), talk)).toBe('/today');
    expect(upTarget(route('/chat/new', { parent: '/chat' }), talk)).toBe('/today');
  });
});

describe('the Back button', () => {
  test('goes back through history when the user came from another screen of the app', () => {
    expect(backAction(route('/work/tasks/t1', { parent: '/work/board' }), work, true)).toEqual({ to: '/work/board', history: true });
    expect(backAction(route('/chat/s1', { parent: '/chat' }), talk, true)).toEqual({ to: '/today', history: true });
  });

  test('goes up the tree on a direct load, where there is nothing to go back to', () => {
    expect(backAction(route('/work/tasks/t1', { parent: '/work/board' }), work, false)).toEqual({ to: '/work/board', history: false });
    expect(backAction(route('/chat/s1', { parent: '/chat' }), talk, false)).toEqual({ to: '/today', history: false });
  });

  test('is not shown on a top-level screen, whatever the history holds', () => {
    expect(backAction(route('/work'), work, true)).toBeNull();
  });
});
