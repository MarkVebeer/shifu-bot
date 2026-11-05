import { Button as UiButton } from '@/components/ui/button';
import type { ChannelKind, ChannelOption } from '@shifubot/shared';
import { Folder, Hash, SpeakerHigh, X } from '@phosphor-icons/react';
import { useGuild } from '../lib/guild';
import { useApi } from '../lib/use-api';
import { Field, Select, Skeleton } from './primitives';

const KIND_ICON: Record<ChannelKind, typeof Hash> = { text: Hash, voice: SpeakerHigh, category: Folder };
/** Plain text glyphs: native <option> elements cannot hold SVG icons. */
const KIND_PREFIX: Record<ChannelKind, string> = { text: '#', voice: '♪', category: '▸' };

/**
 * Pick any number of text channels, voice channels and categories. Chosen ones
 * show as removable chips; a select below adds more.
 */
export function ChannelMultiPicker({
  id,
  value,
  onChange,
  label,
  help,
  placeholder,
  emptyText,
  removeLabel,
  error,
}: {
  id: string;
  value: string[];
  onChange: (ids: string[]) => void;
  label: string;
  help?: string;
  placeholder: string;
  /** Shown when nothing is picked. */
  emptyText: string;
  removeLabel: (name: string) => string;
  error?: string;
}) {
  const { guild } = useGuild();
  const channels = useApi<{ channels: ChannelOption[] }>(`/guilds/${guild.id}/channels?kind=all`);
  const list = channels.data?.channels ?? [];
  const byId = new Map(list.map((channel) => [channel.id, channel]));
  const available = list.filter((channel) => !value.includes(channel.id));

  const groups = available.reduce<Map<string, ChannelOption[]>>((map, channel) => {
    const key = channel.kind === 'category' ? '' : (channel.parentName ?? '');
    map.set(key, [...(map.get(key) ?? []), channel]);
    return map;
  }, new Map());

  const option = (channel: ChannelOption) => (
    <option key={channel.id} value={channel.id}>
      {KIND_PREFIX[channel.kind ?? 'text']} {channel.name}
    </option>
  );

  return (
    <Field label={label} help={help} htmlFor={id} error={error}>
      {channels.loading ? (
        <Skeleton className="h-11 w-full" />
      ) : (
        <div className="space-y-3">
          {value.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {value.map((channelId) => {
                const channel = byId.get(channelId);
                const Icon = KIND_ICON[channel?.kind ?? 'text'];
                const name = channel?.name ?? channelId;
                return (
                  <li key={channelId}>
                    <span className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-muted/50 py-1 pl-3 pr-1 text-sm">
                      <Icon className="size-4 text-muted-foreground" aria-hidden />
                      <span className={channel ? undefined : 'text-muted-foreground line-through'}>{name}</span>
                      <UiButton
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full text-muted-foreground hover:text-destructive"
                        onClick={() => onChange(value.filter((item) => item !== channelId))}
                        aria-label={removeLabel(name)}
                      >
                        <X aria-hidden />
                      </UiButton>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {available.length > 0 && (
            <Select id={id} value="" onChange={(next) => next && onChange([...value, next])} aria-describedby={`${id}-help`}>
              <option value="">{placeholder}</option>
              {[...groups].map(([parent, channelsInGroup]) =>
                parent ? (
                  <optgroup key={parent} label={parent}>
                    {channelsInGroup.map(option)}
                  </optgroup>
                ) : (
                  channelsInGroup.map(option)
                ),
              )}
            </Select>
          )}
        </div>
      )}
    </Field>
  );
}
