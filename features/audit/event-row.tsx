/**
 * One audit log event: a readable summary line and expandable details.
 */
import { ArrowSquareOut, CaretDown, Check, Copy, Hash, User as UserIcon, X } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../../apps/web/src/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Avatar, cx } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { absoluteTime, fieldLabel, relativeTime, typeIcon, typeLabel } from './labels';
import type { AuditEvent, AuditEventsResponse } from './manifest';

type Names = Pick<AuditEventsResponse, 'users' | 'channels' | 'roles'>;

export interface RowActions {
  onUser: (id: string, name: string) => void;
  onChannel: (id: string) => void;
}

/** Keys shown in the summary line, or handled by a special block, so not listed again. */
const HIDDEN_KEYS = new Set(['targetName', 'threadId', 'threadName', 'url', 'messageId', 'reason']);
const USER_KEYS = new Set(['inviterId', 'authorId']);
const CHANNEL_KEYS = new Set(['fromChannelId', 'toChannelId']);
const isUrl = (value: unknown): value is string => typeof value === 'string' && /^https:\/\//.test(value);
const isImage = (value: unknown): value is string => isUrl(value) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(value);

function formatValue(value: unknown, names: Names, key?: string): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') return value ? <Check className="inline size-4" aria-label="true" /> : <X className="inline size-4" aria-label="false" />;
  if (typeof value === 'string') {
    if (key && USER_KEYS.has(key)) return names.users[value]?.name ?? value;
    if (key && CHANNEL_KEYS.has(key)) return names.channels[value] ? `#${names.channels[value]!.name}` : value;
    if (isImage(value)) return <img src={value} alt="" className="size-10 rounded-full ring-1 ring-border" />;
    if (isUrl(value)) {
      return (
        <a href={value} target="_blank" rel="noreferrer noopener" className="break-all text-primary hover:underline">
          {value}
        </a>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  if (typeof value === 'number') {
    // Millisecond timestamps.
    if (key && /At$|since|Since/.test(key) && value > 1_000_000_000_000) return new Date(value).toLocaleString();
    return value.toLocaleString();
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'id' in item)) {
      return value.map((item) => (item as { name?: string; id: string }).name ?? (item as { id: string }).id).join(', ');
    }
    if (value.every((item) => typeof item !== 'object')) return value.join(', ');
  }
  if (typeof value === 'object' && value && 'id' in value) {
    const entity = value as { id: string; name?: string };
    return entity.name ?? names.users[entity.id]?.name ?? names.channels[entity.id]?.name ?? entity.id;
  }
  return <code className="break-all text-xs text-muted-foreground">{JSON.stringify(value)}</code>;
}

function Chip({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  if (!onClick)
    return (
      <Badge variant="secondary" className="max-w-full truncate rounded-full">
        {children}
      </Badge>
    );
  return (
    <Badge asChild variant="secondary" className="max-w-full truncate rounded-full">
      <button
        type="button"
        onClick={(event) => {
          // The chip sits inside the row toggle: filter, do not also open the row.
          event.stopPropagation();
          onClick();
        }}
        title={title}
        className="hover:bg-accent hover:text-accent-foreground"
      >
        {children}
      </button>
    </Badge>
  );
}

export function EventRow({ event, names, actions }: { event: AuditEvent; names: Names; actions: RowActions }) {
  const TypeIcon = typeIcon(event.type);
  const { t, locale } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const data = event.data;

  const user = (id: string | null) => (id ? (names.users[id] ?? null) : null);
  const actor = user(event.actorId);
  const targetUser = event.targetKind === 'user' ? user(event.targetId) : null;
  const avatarUser = actor ?? targetUser;
  const channel = event.channelId ? names.channels[event.channelId] : undefined;

  const userChip = (id: string, label?: string) => {
    const name = user(id)?.name ?? label ?? t('audit.row.unknownUser');
    return (
      <Chip onClick={() => actions.onUser(id, name)} title={t('audit.row.filterUser', { name })}>
        <UserIcon className="size-3 shrink-0" aria-hidden />
        {name}
      </Chip>
    );
  };

  let target: ReactNode = null;
  if (event.targetId && event.targetId !== event.actorId) {
    if (event.targetKind === 'user') target = userChip(event.targetId, data.targetName as string | undefined);
    else if (event.targetKind === 'channel') {
      const name = names.channels[event.targetId]?.name ?? (data.targetName as string | undefined);
      target = <Chip>#{name ?? t('audit.row.unknownChannel')}</Chip>;
    } else if (event.targetKind === 'role') {
      const role = names.roles[event.targetId];
      target = <Chip>@{role?.name ?? (data.targetName as string | undefined) ?? event.targetId}</Chip>;
    } else if (event.targetKind === 'feature') {
      target = <Chip>{t(`${event.targetId}.name` as 'audit.name')}</Chip>;
    } else if (data.targetName) {
      target = <Chip>{String(data.targetName)}</Chip>;
    }
  }

  const changes = Array.isArray(data.changes) ? (data.changes as { key: string; old: unknown; new: unknown }[]) : [];
  const attachments = Array.isArray(data.attachments) ? (data.attachments as { name: string; url: string; size?: number }[]) : [];
  const hasBeforeAfter = 'before' in data || 'after' in data;
  const rest = Object.entries(data).filter(
    ([key]) => !HIDDEN_KEYS.has(key) && key !== 'changes' && key !== 'attachments' && key !== 'content' && key !== 'before' && key !== 'after',
  );
  const discordUrl = typeof data.url === 'string' && data.url.startsWith('https://discord.com/') ? data.url : null;

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast.success(t('audit.row.copied')));
  };

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
    <li className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* A div with the button role: the summary holds its own buttons (user chips), which a <button> cannot contain. */}
      <CollapsibleTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            setOpen((value) => !value);
          }}
          className="flex w-full cursor-pointer items-start gap-3 p-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-4"
        >
        <span className="relative shrink-0">
          {avatarUser ? <Avatar src={avatarUser.avatarUrl} name={avatarUser.name} size={36} /> : <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground"><TypeIcon className="size-4" aria-hidden /></span>}
          {avatarUser && (
            <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-background text-xs ring-1 ring-border" aria-hidden>
              <TypeIcon className="size-3" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="min-w-0 break-words font-semibold">{typeLabel(t, event.type)}</span>
            <time dateTime={new Date(event.at).toISOString()} title={absoluteTime(locale, event.at)} className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(locale, event.at)}
            </time>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {actor && (
              <>
                <span>{t('audit.row.by')}</span>
                {userChip(event.actorId!)}
              </>
            )}
            {!actor && event.actorId && userChip(event.actorId)}
            {target && (
              <>
                <span aria-hidden>→</span>
                {target}
              </>
            )}
            {event.channelId && (
              <>
                <span>{t('audit.row.in')}</span>
                <Chip>
                  <Hash className="size-3 shrink-0" aria-hidden />
                  {channel?.name ?? t('audit.row.unknownChannel')}
                  {typeof data.threadName === 'string' && ` › ${data.threadName}`}
                </Chip>
              </>
            )}
            {typeof data.newAccount === 'boolean' && data.newAccount && <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">{t('audit.row.newAccount')}</span>}
          </span>
          {typeof data.reason === 'string' && <span className="mt-1 block text-sm text-foreground/90">{t('audit.row.reason', { reason: data.reason })}</span>}
          {event.type === 'shifubot.eventsSkipped' && <span className="mt-1 block text-sm text-warning">{t('audit.row.skipped', { count: String(data.count ?? 0) })}</span>}
          {typeof data.content === 'string' && !open && <span className="mt-1 line-clamp-2 block text-sm text-foreground/90">{data.content}</span>}
        </span>
        <CaretDown className={cx('mt-1 size-4 shrink-0 text-muted-foreground transition', open && 'rotate-180')} aria-hidden />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="animate-fade-in space-y-4 border-t bg-background/40 p-3 text-sm sm:p-4">
          {typeof data.content === 'string' && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fieldLabel(t, 'content')}</h3>
              <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3">{data.content}</p>
            </section>
          )}
          {(event.type === 'message.deleted' || event.type === 'message.edited') && data.content === undefined && !hasBeforeAfter && (
            <p className="text-xs text-muted-foreground">{t('audit.row.noContent')}</p>
          )}
          {hasBeforeAfter && (
            <section className="grid gap-3 sm:grid-cols-2">
              {(['before', 'after'] as const).map((key) => (
                <div key={key}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`audit.row.${key}`)}</h3>
                  <div className={cx('rounded-md p-3', key === 'before' ? 'bg-destructive/10' : 'bg-success/10')}>{formatValue(data[key], names, key)}</div>
                </div>
              ))}
            </section>
          )}
          {changes.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fieldLabel(t, 'changes')}</h3>
              <ul className="divide-y divide-border rounded-md bg-muted/40">
                {changes.map((change, index) => (
                  <li key={`${change.key}-${index}`} className="grid gap-1 p-2 sm:grid-cols-[10rem_1fr]">
                    <span className="font-medium text-muted-foreground">{fieldLabel(t, change.key.replace(/^\$/, ''))}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      {change.old !== null && change.old !== undefined && <span className="min-w-0 text-destructive line-through decoration-danger/60">{formatValue(change.old, names, change.key)}</span>}
                      {change.old !== null && change.old !== undefined && change.new !== null && change.new !== undefined && <span aria-hidden>→</span>}
                      {change.new !== null && change.new !== undefined && <span className="min-w-0 text-success">{formatValue(change.new, names, change.key)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {attachments.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fieldLabel(t, 'attachments')}</h3>
              <ul className="space-y-1">
                {attachments.map((file) => (
                  <li key={file.url}>
                    <a href={file.url} target="_blank" rel="noreferrer noopener" className="break-all text-primary hover:underline">
                      {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rest.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
              {rest.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="font-medium text-muted-foreground">{fieldLabel(t, key)}</dt>
                  <dd className="min-w-0">{formatValue(value, names, key)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {discordUrl && (
              <a href={discordUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 font-medium hover:border-primary/60">
                <ArrowSquareOut className="size-3.5" aria-hidden />
                {t('audit.row.openInDiscord')}
              </a>
            )}
            {event.channelId && channel && (
              <UiButton variant="outline" size="sm" className="h-9 rounded-full" onClick={() => actions.onChannel(event.channelId!)}>
                <Hash aria-hidden />
                {t('audit.row.filterChannel', { name: channel.name })}
              </UiButton>
            )}
            {[event.actorId, event.targetId, typeof data.messageId === 'string' ? data.messageId : null]
              .filter((id): id is string => Boolean(id && /^\d{17,20}$/.test(id)))
              .filter((id, index, all) => all.indexOf(id) === index)
              .map((id) => (
                <UiButton key={id} variant="outline" size="sm" className="h-9 rounded-full font-mono text-muted-foreground" onClick={() => copy(id)} title={t('audit.row.copyId')}>
                  <Copy aria-hidden />
                  {id}
                </UiButton>
              ))}
          </div>
        </div>
      </CollapsibleContent>
    </li>
    </Collapsible>
  );
}
