import { LOCALES, accentPresets, type Locale } from '@shifubot/shared';
import { ArrowCounterClockwise, Translate } from '@phosphor-icons/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
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
import { useT } from '../lib/i18n';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button, cx, Input } from './primitives';

/** Segmented English / Magyar switch (shadcn/ui ToggleGroup). */
export function LanguageSwitcher({ value, onChange, id }: { value: Locale; onChange: (locale: Locale) => void; id?: string }) {
  const t = useT();
  const generated = useId();
  const labelId = `${id ?? generated}-label`;
  return (
    <div className="flex items-center gap-2">
      <Translate className="size-4 text-muted-foreground" aria-hidden />
      <span id={labelId} className="sr-only">
        {t('lang.label')}
      </span>
      <ToggleGroup type="single" variant="outline" value={value} onValueChange={(next) => next && onChange(next as Locale)} aria-labelledby={labelId}>
        {LOCALES.map((locale) => (
          <ToggleGroupItem key={locale} value={locale} className="h-9 px-3.5">
            {t(`lang.${locale}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export interface Choice<V extends string> {
  value: V;
  title: ReactNode;
  hint?: ReactNode;
  /** Shown before the title, e.g. a LocaleBadge. */
  leading?: ReactNode;
}

/** Pick one of a few options shown as cards (shadcn/ui RadioGroup). */
export function ChoiceCards<V extends string>({
  value,
  onChange,
  choices,
  className,
  ...aria
}: {
  value: V;
  onChange: (value: V) => void;
  choices: Choice<V>[];
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const groupId = useId();
  return (
    <RadioGroup value={value} onValueChange={(next) => onChange(next as V)} className={cx('grid gap-3 sm:grid-cols-2', className)} {...aria}>
      {choices.map((choice) => {
        const id = `${groupId}-${choice.value}`;
        return (
          <Label
            key={choice.value}
            htmlFor={id}
            className="flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 font-normal transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-brand/60 has-[[data-state=checked]]:bg-brand/[0.06]"
          >
            <RadioGroupItem id={id} value={choice.value} className="mt-0.5" />
            {choice.leading}
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block font-semibold">{choice.title}</span>
              {choice.hint && <span className="block text-sm text-muted-foreground">{choice.hint}</span>}
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}

/** Color picker with brand presets and a hex input. null means the brand primary. */
export function ColorField({
  id,
  value,
  fallback,
  onChange,
}: {
  id: string;
  value: string | null;
  fallback: string;
  onChange: (value: string | null) => void;
}) {
  const t = useT();
  const current = (value ?? fallback).toUpperCase();
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('colorField.label')}>
        {accentPresets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset === fallback ? null : preset)}
            aria-label={preset}
            aria-pressed={current === preset.toUpperCase()}
            className={cx(
              'size-10 rounded-full ring-2 ring-offset-2 ring-offset-surface transition hover:scale-105',
              current === preset.toUpperCase() ? 'ring-foreground' : 'ring-transparent',
            )}
            style={{ background: preset }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border" style={{ background: current }}>
          <span className="sr-only">{t('colorField.label')}</span>
          <input
            type="color"
            value={current.toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          id={id}
          aria-label={t('colorField.hex')}
          value={draft}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!/^#[0-9a-fA-F]{6}$/.test(draft)}
          onChange={(event) => {
            const next = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`;
            setDraft(next.toUpperCase());
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toUpperCase());
          }}
          onBlur={() => setDraft(current)}
          className="w-32 font-mono uppercase"
        />
        {value !== null && (
          <Button variant="ghost" onClick={() => onChange(null)} icon={<ArrowCounterClockwise className="size-4" aria-hidden />}>
            {t('colorField.reset')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Sticky save bar shown while a form has unsaved changes. */
export function SaveBar({ visible, saving, onSave, onDiscard }: { visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  const t = useT();
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 lg:sticky lg:bottom-4 lg:px-0">
      <div
        role="region"
        aria-label={t('common.unsaved')}
        data-slot="card" className="pointer-events-auto mx-auto flex max-w-3xl animate-fade-up items-center gap-3 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
      >
        <span className="size-2 shrink-0 rounded-full bg-warning motion-safe:animate-pulse" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{t('common.unsaved')}</p>
        <Button variant="ghost" onClick={onDiscard} disabled={saving} className="px-3">
          {t('common.discard')}
        </Button>
        <Button onClick={onSave} loading={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/** Modal confirmation for destructive actions (shadcn/ui AlertDialog). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="min-h-11" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
