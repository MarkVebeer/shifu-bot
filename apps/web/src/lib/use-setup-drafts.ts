import type { GuildOverview } from '@shifubot/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { setupSections } from '../setup-sections';
import type { AppMessageKey } from '../../../../features';

type Values = Record<string, unknown>;

/**
 * Loads every setup section, keeps an editable draft of each and saves the
 * changed ones. Shared by the setup wizard and the Settings tab.
 */
export function useSetupDrafts(guild: GuildOverview) {
  const [saved, setSaved] = useState<Values | null>(null);
  const [drafts, setDrafts] = useState<Values | null>(null);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const values = await Promise.all(setupSections.map((section) => section.load(guild)));
      const loaded = Object.fromEntries(setupSections.map((section, index) => [section.id, values[index]]));
      setSaved(loaded);
      setDrafts(loaded);
    } catch (err) {
      setError(err);
    }
    // Load once per server; `guild` changes identity whenever the overview reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(
    () =>
      saved && drafts
        ? setupSections.filter((section) => JSON.stringify(drafts[section.id]) !== JSON.stringify(saved[section.id]))
        : [],
    [saved, drafts],
  );

  const setDraft = useCallback((id: string, value: unknown) => {
    setDrafts((current) => (current ? { ...current, [id]: value } : current));
  }, []);

  const problem = useCallback(
    (id: string): AppMessageKey | null => {
      const section = setupSections.find((item) => item.id === id);
      return section && drafts ? (section.validate?.(drafts[id] as never) ?? null) : null;
    },
    [drafts],
  );

  /** Save changed sections. Feature sections first, the language last, so texts follow the final language. */
  const saveChanged = useCallback(async () => {
    if (!drafts) return;
    const ordered = [...changed].sort((a, b) => Number(a.id === 'language') - Number(b.id === 'language'));
    for (const section of ordered) await section.save(guild, drafts[section.id] as never);
    setSaved(drafts);
  }, [changed, drafts, guild]);

  const reset = useCallback(() => setDrafts(saved), [saved]);

  return {
    sections: setupSections,
    drafts,
    error,
    reload: load,
    setDraft,
    problem,
    changed,
    dirty: changed.length > 0,
    saveChanged,
    reset,
  };
}
