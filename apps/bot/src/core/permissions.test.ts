import { describe, expect, test } from 'bun:test';
import { BOT_PERMISSIONS } from '@shifubot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { INVITE_PERMISSIONS } from './permissions';
import { loadServerFeatures } from './registry';

describe('INVITE_PERMISSIONS', () => {
  test('covers every permission a feature needs, so the grant link can fix any server wide gap', async () => {
    for (const feature of await loadServerFeatures()) {
      for (const permission of feature.permissions) {
        expect(BOT_PERMISSIONS).toContain(permission);
        expect(INVITE_PERMISSIONS & PermissionFlagsBits[permission]).toBe(PermissionFlagsBits[permission]);
      }
    }
  });
});
