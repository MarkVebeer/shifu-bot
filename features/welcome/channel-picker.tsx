import { emoji, type ChannelOption } from '@shifubot/shared';
import { useGuild } from '../../apps/web/src/lib/guild';
import { useT } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { Alert, Field, Select, Skeleton } from '../../apps/web/src/ui/primitives';

/** Welcome channel picker. Lists only text channels where the bot can write (plus the current one). */
export function WelcomeChannelPicker({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string | null;
  onChange: (channelId: string | null) => void;
  error?: string;
}) {
  const t = useT();
  const { guild } = useGuild();
  const channels = useApi<{ channels: ChannelOption[] }>(`/guilds/${guild.id}/channels`);

  const writable = (channels.data?.channels ?? []).filter((channel) => channel.canSend || channel.id === value);
  const groups = writable.reduce<Map<string, ChannelOption[]>>((map, channel) => {
    const key = channel.parentName ?? '';
    map.set(key, [...(map.get(key) ?? []), channel]);
    return map;
  }, new Map());

  return (
    <Field label={t('welcome.form.channel')} help={t('welcome.form.channelHelp')} htmlFor={id} error={error}>
      {channels.loading ? (
        <Skeleton className="h-11 w-full" />
      ) : writable.length === 0 ? (
        <Alert tone="warning">{t('welcome.form.noChannels')}</Alert>
      ) : (
        <Select id={id} value={value ?? ''} onChange={(next) => onChange(next || null)} aria-describedby={`${id}-help`}>
          <option value="">{t('welcome.form.channelPlaceholder')}</option>
          {[...groups].map(([parent, list]) => {
            const options = list.map((channel) => (
              <option key={channel.id} value={channel.id}>
                # {channel.name}
                {channel.canSend ? '' : ` ${emoji.warning}`}
              </option>
            ));
            return parent ? (
              <optgroup key={parent} label={parent}>
                {options}
              </optgroup>
            ) : (
              options
            );
          })}
        </Select>
      )}
    </Field>
  );
}
