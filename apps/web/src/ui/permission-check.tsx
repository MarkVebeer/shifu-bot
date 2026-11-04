/**
 * Shows what ShifuBot is missing in this server and how to fix it: a
 * re-authorize link for server wide permissions, and step by step hints for
 * channel overrides and role order, which only an admin can change in Discord.
 */
import { emoji, type BotPermission, type PermissionIssue } from '@shifubot/shared';
import { ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { AppMessageKey } from '../../../../features';
import { useGuild } from '../lib/guild';
import { useT } from '../lib/i18n';
import { Alert, Button, ButtonLink, Card, CardHeader, Skeleton } from './primitives';
import { useToast } from './toast';

export function PermissionCheck({ variant }: { variant: 'banner' | 'card' }) {
  const t = useT();
  const toast = useToast();
  const { guild, permissions } = useGuild();
  const [checking, setChecking] = useState(false);
  const report = permissions.data;

  const recheck = async () => {
    setChecking(true);
    await permissions.reload();
    setChecking(false);
    toast.success(t('permissions.checked'));
  };

  const featureName = (id: string) => t(`${id}.name` as AppMessageKey);
  const permissionNames = (list: BotPermission[]) => list.map((name) => t(`permissions.names.${name}`)).join(', ');

  if (variant === 'banner' && (!report || report.ok)) return null;

  if (variant === 'card' && !report) {
    return (
      <Card>
        <CardHeader icon={<KeyRound className="size-5 text-primary" />} title={t('permissions.title')} />
        <Skeleton className="h-6 w-2/3" />
      </Card>
    );
  }

  if (report!.ok) {
    return (
      <Card>
        <CardHeader icon={<KeyRound className="size-5 text-primary" />} title={t('permissions.title')} />
        <p className="flex items-center gap-2 text-sm">
          <span aria-hidden>{emoji.success}</span>
          {t('permissions.ok')}
        </p>
      </Card>
    );
  }

  const { missing, issues, grantUrl } = report!;
  const channelIssues = issues.filter((issue) => issue.channel && issue.permissions?.length);

  const issueText = (issue: PermissionIssue) => {
    const problem = t(`${issue.feature}.errors.${issue.code}` as AppMessageKey);
    return issue.channel
      ? t('permissions.channelIssue', { feature: featureName(issue.feature), problem, channel: issue.channel.name })
      : t('permissions.issue', { feature: featureName(issue.feature), problem });
  };

  return (
    <Alert
      tone="danger"
      action={
        <Button variant="ghost" size="icon" onClick={recheck} loading={checking} aria-label={t('permissions.recheck')} title={t('permissions.recheck')}>
          <RefreshCw className="size-4" aria-hidden />
        </Button>
      }
    >
      <p className="font-semibold">{t('permissions.problemTitle')}</p>
      <p className="text-muted">{t('permissions.problemBody')}</p>

      {missing.length > 0 && (
        <div className="mt-3 space-y-3">
          <ul className="list-disc space-y-1 pl-5">
            {missing.map((item) => (
              <li key={item.permission}>
                <span className="font-medium">{t(`permissions.names.${item.permission}`)}</span>{' '}
                <span className="text-muted">({t('permissions.neededBy', { features: item.features.map(featureName).join(', ') })})</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ButtonLink href={grantUrl} external icon={<KeyRound className="size-4" aria-hidden />}>
              {t('permissions.grant')}
            </ButtonLink>
            <p className="text-xs text-muted">{t('permissions.grantHelp')}</p>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-3 space-y-2">
          <ul className="list-disc space-y-1 pl-5">
            {issues.map((issue) => (
              <li key={`${issue.feature}:${issue.code}:${issue.channel?.id ?? ''}`}>
                {issueText(issue)}
                {issue.permissions?.length ? <span className="text-muted"> ({permissionNames(issue.permissions)})</span> : null}
                {issue.channel && (
                  <a
                    href={`https://discord.com/channels/${guild.id}/${issue.channel.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t('permissions.openChannel')}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {channelIssues.length > 0 && <p className="text-xs text-muted">{t('permissions.channelFix')}</p>}
        </div>
      )}
    </Alert>
  );
}
