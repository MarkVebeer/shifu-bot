import { describe, expect, mock, test } from 'bun:test';
import type { Guild } from 'discord.js';
import type { Logger } from '../logger';
import { isGuildAllowed, leaveIfNotAllowed } from './guild-allowlist';

const ALLOWED = '111111111111111111';
const OTHER = '222222222222222222';

const logger = { warn: mock(), error: mock() } as unknown as Logger;

function fakeGuild(id: string, leave: () => Promise<unknown> = async () => undefined) {
  const spy = mock(leave);
  return { guild: { id, name: 'Test', leave: spy } as unknown as Pick<Guild, 'id' | 'name' | 'leave'>, leave: spy };
}

describe('isGuildAllowed', () => {
  test('an empty list allows every server', () => {
    expect(isGuildAllowed(new Set(), OTHER)).toBe(true);
  });

  test('a list allows only its own servers', () => {
    const allowed = new Set([ALLOWED]);
    expect(isGuildAllowed(allowed, ALLOWED)).toBe(true);
    expect(isGuildAllowed(allowed, OTHER)).toBe(false);
  });
});

describe('leaveIfNotAllowed', () => {
  test('stays when the list is empty', async () => {
    const { guild, leave } = fakeGuild(OTHER);
    expect(await leaveIfNotAllowed(guild, new Set(), logger)).toBe(false);
    expect(leave).not.toHaveBeenCalled();
  });

  test('stays in a server on the list', async () => {
    const { guild, leave } = fakeGuild(ALLOWED);
    expect(await leaveIfNotAllowed(guild, new Set([ALLOWED]), logger)).toBe(false);
    expect(leave).not.toHaveBeenCalled();
  });

  test('leaves a server off the list', async () => {
    const { guild, leave } = fakeGuild(OTHER);
    expect(await leaveIfNotAllowed(guild, new Set([ALLOWED]), logger)).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  test('still reports not allowed when leaving fails', async () => {
    const { guild } = fakeGuild(OTHER, async () => {
      throw new Error('Discord is down');
    });
    expect(await leaveIfNotAllowed(guild, new Set([ALLOWED]), logger)).toBe(true);
  });
});
