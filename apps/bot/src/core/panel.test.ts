import { describe, expect, test } from 'bun:test';
import { ChannelType, DiscordAPIError } from 'discord.js';
import { syncPanelMessage } from './panel';

/** Just enough of a guild and its text channels for the panel helper. */
function fakeGuild(options: { editFails?: number } = {}) {
  const calls: string[] = [];
  const me = { id: 'bot' };
  const channel = (id: string) => ({
    id,
    name: id,
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    send: async () => {
      calls.push(`send:${id}`);
      return { id: `msg-${calls.length}` };
    },
    messages: {
      edit: async (messageId: string) => {
        calls.push(`edit:${id}:${messageId}`);
        if (options.editFails) {
          throw new DiscordAPIError({ message: 'Unknown Message', code: options.editFails }, options.editFails, 404, 'PATCH', '/x', {});
        }
      },
      delete: async (messageId: string) => {
        calls.push(`delete:${id}:${messageId}`);
      },
    },
  });
  const channels = new Map([
    ['a', channel('a')],
    ['b', channel('b')],
  ]);
  const guild = { id: 'g', members: { me }, channels: { cache: channels } } as never;
  return { guild, calls };
}

const queue = { run: <T>(_key: string, task: () => Promise<T>) => task() } as never;
const payload = { embeds: [], allowedMentions: { users: [], roles: [], parse: [] as [] } };

describe('syncPanelMessage', () => {
  test('posts a new panel when there is none', async () => {
    const { guild, calls } = fakeGuild();
    const result = await syncPanelMessage({ guild, queue, queueKey: 'k', existing: null, target: { channelId: 'a', payload } });
    expect(result).toMatchObject({ ok: true, panel: { channelId: 'a', messageId: 'msg-1' } });
    expect(calls).toEqual(['send:a']);
  });

  test('edits the panel in place when the channel did not change', async () => {
    const { guild, calls } = fakeGuild();
    const existing = { channelId: 'a', messageId: 'm1' };
    const result = await syncPanelMessage({ guild, queue, queueKey: 'k', existing, target: { channelId: 'a', payload } });
    expect(result).toMatchObject({ ok: true, panel: existing });
    expect(calls).toEqual(['edit:a:m1']);
  });

  test('moves the panel to a new channel', async () => {
    const { guild, calls } = fakeGuild();
    await syncPanelMessage({ guild, queue, queueKey: 'k', existing: { channelId: 'a', messageId: 'm1' }, target: { channelId: 'b', payload } });
    expect(calls).toEqual(['delete:a:m1', 'send:b']);
  });

  test('reposts a panel deleted by hand, or reports it when asked not to', async () => {
    const existing = { channelId: 'a', messageId: 'm1' };
    const repost = fakeGuild({ editFails: 10008 });
    expect(await syncPanelMessage({ guild: repost.guild, queue, queueKey: 'k', existing, target: { channelId: 'a', payload } })).toMatchObject({ ok: true });
    expect(repost.calls).toEqual(['edit:a:m1', 'send:a']);

    const keep = fakeGuild({ editFails: 10008 });
    expect(
      await syncPanelMessage({ guild: keep.guild, queue, queueKey: 'k', existing, target: { channelId: 'a', payload }, repostIfDeleted: false }),
    ).toEqual({ ok: false, error: 'panel_deleted' });
    expect(keep.calls).toEqual(['edit:a:m1']);
  });

  test('maps permission errors and removes the panel when there is no target', async () => {
    const denied = fakeGuild({ editFails: 50013 });
    expect(
      await syncPanelMessage({ guild: denied.guild, queue, queueKey: 'k', existing: { channelId: 'a', messageId: 'm1' }, target: { channelId: 'a', payload } }),
    ).toEqual({ ok: false, error: 'missing_permissions' });

    const removed = fakeGuild();
    expect(await syncPanelMessage({ guild: removed.guild, queue, queueKey: 'k', existing: { channelId: 'a', messageId: 'm1' }, target: null })).toEqual({
      ok: true,
      panel: null,
      channel: null,
    });
    expect(removed.calls).toEqual(['delete:a:m1']);
  });

  test('reports a missing channel without calling Discord', async () => {
    const { guild, calls } = fakeGuild();
    expect(await syncPanelMessage({ guild, queue, queueKey: 'k', existing: null, target: { channelId: 'zzz', payload } })).toEqual({
      ok: false,
      error: 'channel_missing',
    });
    expect(calls).toEqual([]);
  });
});
