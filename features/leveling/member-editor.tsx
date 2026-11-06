/**
 * Side panel to correct one member's XP: add, take away or set it, with a live preview of the
 * result. Full width on a phone.
 */
import { Equals, Minus, Plus, X } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { formatNumber } from '../../apps/web/src/ui/member-list';
import { Avatar, Button, Field, Input } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ChoiceCards, ConfirmDialog } from '../../apps/web/src/ui/widgets';
import { LevelBadge } from './level-badge';
import { activeTracks, levelFromXp, levelsFor, MAX_MEMBER_XP, shownLevels, totalXpForLevel, type LeaderboardKind, type LevelTrack, type XpOp, type XpSources } from './manifest';
import type { XpChangeResponse } from './server';
import { adjustedXp } from './xp';

export interface EditTarget {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  textXp: number;
  voiceXp: number;
  /** Place on the list, or null when the member is not ranked (left, or no XP yet). */
  rank: number | null;
  left: boolean;
}

const PRESETS = [100, 500, 1000, 5000];
const MAX_LEVEL = levelFromXp(MAX_MEMBER_XP).level;
const OP_ICONS: Record<XpOp, ReactNode> = { add: <Plus aria-hidden />, remove: <Minus aria-hidden />, set: <Equals aria-hidden /> };

export function MemberEditor({
  target,
  sources,
  by,
  onClose,
  onSaved,
  onReset,
}: {
  target: EditTarget;
  sources: XpSources;
  by: LeaderboardKind;
  onClose: () => void;
  onSaved: (member: EditTarget, track: LevelTrack, result: XpChangeResponse) => void;
  onReset: (member: EditTarget) => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { guild } = useGuild();
  const id = useId();
  const tracks = activeTracks(sources);
  const [track, setTrack] = useState<LevelTrack>(tracks[0]!);
  const [op, setOp] = useState<XpOp>('add');
  const [unit, setUnit] = useState<'xp' | 'level'>('xp');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const base = `/guilds/${guild.id}/features/leveling/members/${target.userId}`;
  const n = (value: number) => formatNumber(value, locale);
  const xpOf = (which: LevelTrack) => (which === 'text' ? target.textXp : target.voiceXp);
  const current = xpOf(track);
  const levels = levelsFor(target);

  const byLevel = op === 'set' && unit === 'level';
  const limit = byLevel ? MAX_LEVEL : MAX_MEMBER_XP;
  const typed = amount === '' ? null : Number(amount);
  const tooBig = typed !== null && typed > limit;
  const xpAmount = typed === null || tooBig ? null : byLevel ? totalXpForLevel(typed) : typed;
  const after = xpAmount === null ? null : adjustedXp(current, op, xpAmount);
  const changed = after !== null && after !== current;

  const levelLine = (label: string, from: number, to: number) => t('leveling.manager.editor.previewLevel', { label, from: levelFromXp(from).level, to: levelFromXp(to).level });

  const save = async () => {
    if (!changed || xpAmount === null) return;
    setSaving(true);
    try {
      const result = await api<XpChangeResponse>(`${base}/xp?by=${by}`, {
        method: 'POST',
        body: { track, op, amount: xpAmount, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      onSaved(target, track, result);
    } catch (error) {
      toast.error(errorText(t, error));
      setSaving(false);
    }
  };

  const reset = async () => {
    setConfirmReset(false);
    try {
      await api<XpChangeResponse>(`${base}/reset`, { method: 'POST' });
      onReset(target);
    } catch (error) {
      toast.error(errorText(t, error));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <header className="flex items-start gap-3 border-b p-4 sm:p-5">
          <Avatar src={target.avatarUrl} name={target.displayName} size={48} />
          <div className="min-w-0 flex-1">
            <SheetTitle className="break-words text-lg leading-snug">{target.displayName}</SheetTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {target.rank !== null && <span className="mr-1 text-sm text-muted-foreground">{t('leveling.manager.place', { rank: n(target.rank) })}</span>}
              {target.left && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t('leveling.manager.left')}</span>}
              {shownLevels(sources).map((kind) => (
                <LevelBadge key={kind} kind={kind} level={levels[kind].level} compact />
              ))}
            </div>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label={t('leveling.manager.editor.close')} className="-mr-2 -mt-2 shrink-0">
              <X className="size-4" aria-hidden />
            </Button>
          </SheetClose>
        </header>

        <form
          className="flex flex-1 flex-col gap-5 p-4 sm:p-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SheetDescription>{t('leveling.manager.editor.help')}</SheetDescription>

          {tracks.length > 1 && (
            <div className="space-y-2">
              <p id={`${id}-track`} className="text-[13px] font-medium">
                {t('leveling.manager.editor.track')}
              </p>
              <ChoiceCards
                aria-labelledby={`${id}-track`}
                value={track}
                onChange={setTrack}
                className="grid-cols-2 @md:grid-cols-2"
                choices={tracks.map((item) => ({
                  value: item,
                  title: t(`leveling.tracks.${item}`),
                  hint: t('leveling.manager.editor.trackHint', { level: levelFromXp(xpOf(item)).level, xp: n(xpOf(item)) }),
                }))}
              />
            </div>
          )}

          <div className="space-y-2">
            <p id={`${id}-action`} className="text-[13px] font-medium">
              {t('leveling.manager.editor.action')}
            </p>
            <ToggleGroup type="single" variant="outline" value={op} onValueChange={(next) => next && setOp(next as XpOp)} aria-labelledby={`${id}-action`} className="w-full">
              {(['add', 'remove', 'set'] as const).map((item) => (
                <ToggleGroupItem key={item} value={item} className="h-11 min-w-0 flex-1 px-2 max-sm:[&>svg]:hidden">
                  {OP_ICONS[item]}
                  <span className="truncate">{t(`leveling.manager.editor.ops.${item}`)}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {op === 'set' && (
            <div className="space-y-2">
              <p id={`${id}-unit`} className="text-[13px] font-medium">
                {t('leveling.manager.editor.unit')}
              </p>
              <ToggleGroup type="single" variant="outline" value={unit} onValueChange={(next) => next && setUnit(next as 'xp' | 'level')} aria-labelledby={`${id}-unit`} className="w-full">
                <ToggleGroupItem value="xp" className="h-11 flex-1">
                  {t('leveling.manager.editor.unitXp')}
                </ToggleGroupItem>
                <ToggleGroupItem value="level" className="h-11 flex-1">
                  {t('leveling.manager.editor.unitLevel')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}

          <div className="space-y-2">
            <Field
              label={t('leveling.manager.editor.amount')}
              htmlFor={`${id}-amount`}
              error={tooBig ? t('leveling.manager.editor.tooBig', { max: n(limit) }) : undefined}
              help={byLevel ? t('leveling.manager.editor.levelHelp') : undefined}
            >
              <Input
                id={`${id}-amount`}
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                aria-invalid={tooBig || undefined}
                onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            </Field>
            {op !== 'set' && (
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((preset) => (
                  <Button key={preset} variant="secondary" className="min-w-0 px-1 font-mono" onClick={() => setAmount(String(preset))}>
                    {n(preset)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div aria-live="polite" className="rounded-lg border bg-muted/50 p-4 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('leveling.manager.editor.preview')}</p>
            {after === null ? (
              <p className="text-muted-foreground">{t('leveling.manager.editor.previewEmpty')}</p>
            ) : !changed ? (
              <p className="text-muted-foreground">{t('leveling.manager.editor.noChange')}</p>
            ) : (
              <div className="space-y-0.5">
                <p className="font-semibold">{levelLine(t(`leveling.tracks.${track}`), current, after)}</p>
                <p className="font-mono">{t('leveling.manager.editor.previewXp', { from: n(current), to: n(after) })}</p>
                {tracks.length > 1 && <p className="text-muted-foreground">{levelLine(t('leveling.tracks.overall'), levels.totalXp, levels.totalXp - current + after)}</p>}
              </div>
            )}
            {xpAmount !== null && op === 'remove' && xpAmount > current && current > 0 && <p className="mt-2 text-warning">{t('leveling.manager.editor.clampedZero', { xp: n(current) })}</p>}
            {xpAmount !== null && op === 'add' && current + xpAmount > MAX_MEMBER_XP && <p className="mt-2 text-warning">{t('leveling.manager.editor.clampedMax', { max: n(MAX_MEMBER_XP) })}</p>}
          </div>

          <Field label={t('leveling.manager.editor.reason')} htmlFor={`${id}-reason`} optional optionalLabel={t('common.optional')} help={t('leveling.manager.editor.reasonHelp')}>
            <Input id={`${id}-reason`} value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
          </Field>

          <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row-reverse">
            <Button type="submit" loading={saving} disabled={!changed} className="sm:flex-1">
              {saving ? t('common.saving') : t('leveling.manager.editor.save')}
            </Button>
            <SheetClose asChild>
              <Button variant="secondary" className="sm:flex-1">
                {t('common.cancel')}
              </Button>
            </SheetClose>
          </div>

          {levels.totalXp > 0 && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmReset(true)}>
              {t('leveling.manager.editor.reset')}
            </Button>
          )}
        </form>

        <ConfirmDialog
          open={confirmReset}
          title={t('leveling.manager.editor.resetTitle', { name: target.displayName })}
          body={t('leveling.manager.editor.resetBody')}
          confirmLabel={t('leveling.manager.editor.resetConfirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void reset()}
          onCancel={() => setConfirmReset(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
