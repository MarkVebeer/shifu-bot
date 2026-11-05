import type { RoleOption } from '@shifubot/shared';
import { useGuild } from '../lib/guild';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/use-api';
import { Alert, Field, Select, Skeleton } from './primitives';

/**
 * Role picker for features that give roles. Roles ShifuBot cannot give (above
 * its highest role, or managed by an integration) are listed but disabled, so
 * admins see why their role is missing.
 */
export function RolePicker({
  id,
  value,
  onChange,
  error,
  label,
  help,
}: {
  id: string;
  value: string | null;
  onChange: (roleId: string | null) => void;
  error?: string;
  /** Overrides the default "Role" label. */
  label?: string;
  help?: string;
}) {
  const t = useT();
  const { guild } = useGuild();
  const roles = useApi<{ roles: RoleOption[] }>(`/guilds/${guild.id}/roles`);
  const list = roles.data?.roles ?? [];
  const selected = list.find((role) => role.id === value);

  return (
    <Field label={label ?? t('rolePicker.label')} help={help ?? t('rolePicker.help')} htmlFor={id} error={error}>
      {roles.loading ? (
        <Skeleton className="h-11 w-full" />
      ) : list.length === 0 ? (
        <Alert tone="warning">{t('rolePicker.noRoles')}</Alert>
      ) : (
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full border border-border"
            style={{ background: selected?.color ?? 'transparent' }}
          />
          <div className="min-w-0 flex-1">
            <Select id={id} value={value ?? ''} onChange={(next) => onChange(next || null)} aria-describedby={`${id}-help`}>
              <option value="">{t('rolePicker.placeholder')}</option>
              {list.map((role) => (
                <option key={role.id} value={role.id} disabled={!role.assignable && role.id !== value}>
                  @{role.name}
                  {role.assignable ? '' : ` (${t('rolePicker.tooHigh')})`}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </Field>
  );
}
