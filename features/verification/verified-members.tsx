/**
 * The verified members tab: who is on the list, adding someone by user id, and taking someone off,
 * with or without the verified role.
 */
import { snowflake } from '@shifubot/shared';
import { Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { formatNumber, RankedList, SearchBox, useRankedList } from '../../apps/web/src/ui/member-list';
import { Alert, Avatar, Button, Card, Field, Input, Skeleton } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import type { AddVerifiedResponse, RemoveVerifiedResponse, VerificationStatus, VerifiedMember, VerifiedMemberErrorCode, VerifiedMembersResponse } from './server';

const MEMBER_ERROR_CODES: Record<VerifiedMemberErrorCode, true> = {
  no_role: true,
  role_missing: true,
  role_managed: true,
  no_manage_roles: true,
  role_too_high: true,
  role_failed: true,
  role_remove_failed: true,
  already_verified: true,
  unknown_user: true,
  is_bot: true,
};

export function VerifiedMembers({ roleProblem, onChanged }: { roleProblem: VerificationStatus['roleProblem']; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { guild } = useGuild();
  const base = `/guilds/${guild.id}/features/verification/members`;
  const list = useRankedList<VerifiedMember, VerifiedMembersResponse>(base);
  const [userId, setUserId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<VerifiedMember | null>(null);

  const showError = (error: unknown) => {
    const code = (error as { code?: string }).code ?? '';
    toast.error(code in MEMBER_ERROR_CODES ? t(`verification.errors.${code as VerifiedMemberErrorCode}`) : errorText(t, error));
  };

  if (list.state.kind === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (list.state.kind === 'error') {
    return (
      <Alert tone="danger" action={<Button variant="secondary" onClick={list.retry}>{t('common.retry')}</Button>}>
        {errorText(t, { code: list.state.code })}
      </Alert>
    );
  }

  const { data } = list.state;
  const validId = snowflake.safeParse(userId).success;

  const add = async () => {
    if (!validId) return;
    setAdding(true);
    try {
      const result = await api<AddVerifiedResponse>(base, { method: 'POST', body: { userId } });
      setUserId('');
      list.retry();
      onChanged();
      toast.success(t(result.onServer ? 'verification.members.added' : 'verification.members.addedLater', { name: result.displayName }));
    } catch (error) {
      showError(error);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (member: VerifiedMember, removeRole: boolean) => {
    try {
      const result = await api<RemoveVerifiedResponse>(`${base}/${member.userId}/remove`, { method: 'POST', body: { removeRole } });
      list.updateData((current) => {
        const entries = current.entries.filter((entry) => entry.userId !== member.userId);
        return { ...current, entries, matches: current.matches - 1, members: current.members - 1 };
      });
      onChanged();
      toast.success(t(result.removedRole ? 'verification.members.removedRole' : 'verification.members.removed', { name: member.displayName }));
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="space-y-4">
      {roleProblem && <Alert tone="warning">{t('verification.members.roleProblem', { error: t(`verification.errors.${roleProblem}`) })}</Alert>}

      <Card className="sm:p-4">
        <form
          className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,1fr)_auto]"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Field
            label={t('verification.members.addLabel')}
            htmlFor="verified-add-id"
            help={t('verification.members.addHelp')}
            error={userId && !validId ? t('verification.members.addInvalid') : undefined}
          >
            <Input
              id="verified-add-id"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              value={userId}
              aria-invalid={Boolean(userId && !validId) || undefined}
              onChange={(event) => setUserId(event.target.value.replace(/\D/g, '').slice(0, 20))}
            />
          </Field>
          <Button type="submit" className="@2xl:mt-6" loading={adding} disabled={!validId} icon={<Plus className="size-4" aria-hidden />}>
            {t('verification.members.add')}
          </Button>
        </form>
      </Card>

      <Card className="sm:p-4">
        <Field label={t('memberPages.searchLabel')} htmlFor="verified-search" help={t('verification.members.searchHelp')}>
          <SearchBox id="verified-search" value={list.search} onChange={list.setSearch} />
        </Field>
      </Card>

      <section aria-live="polite" className="min-w-0 space-y-4">
        <div>
          <p className="text-sm font-medium">{t('verification.members.count', { count: formatNumber(data.members, locale) })}</p>
          <p className="text-sm text-muted-foreground">{t('verification.members.help')}</p>
        </div>
        <RankedList
          q={list.q}
          matches={data.matches}
          shown={data.entries.length}
          emptyText={t('verification.members.empty')}
          loadingMore={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
        >
          {data.entries.map((entry) => (
            <MemberRow key={entry.userId} member={entry} onRemove={setRemoving} />
          ))}
        </RankedList>
      </section>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('verification.members.removeTitle', { name: removing?.displayName ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t(removing?.hasRole ? 'verification.members.removeBodyRole' : 'verification.members.removeBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant={removing?.hasRole ? 'outline' : 'destructive'} className="min-h-11" onClick={() => removing && void remove(removing, false)}>
              {t('verification.members.removeOnly')}
            </AlertDialogAction>
            {removing?.hasRole && (
              <AlertDialogAction variant="destructive" className="min-h-11" onClick={() => void remove(removing, true)}>
                {t('verification.members.removeWithRole')}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemberRow({ member, onRemove }: { member: VerifiedMember; onRemove: (member: VerifiedMember) => void }) {
  const { t, locale } = useI18n();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(member.verifiedAt);
  const flag = !member.onServer ? t('verification.members.left') : !member.hasRole ? t('verification.members.noRole') : null;
  return (
    <li className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 shadow-sm sm:gap-4 sm:px-4">
      <Avatar src={member.avatarUrl} name={member.displayName} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{member.displayName}</span>
          {flag && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{flag}</span>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {t('verification.members.verifiedAt', { time })} · <span className="font-mono">{member.userId}</span>
        </span>
      </span>
      <Button variant="ghost" onClick={() => onRemove(member)} aria-label={t('verification.members.removeMember', { name: member.displayName })} icon={<Trash className="size-4" aria-hidden />}>
        <span className="hidden @2xl:inline">{t('verification.members.remove')}</span>
      </Button>
    </li>
  );
}
