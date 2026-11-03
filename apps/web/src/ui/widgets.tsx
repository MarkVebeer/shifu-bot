import { LOCALES, accentPresets, type Locale } from '@shifubot/shared';
import { Languages, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { Button, cx } from './primitives';

/** Segmented English / Magyar switch. */
export function LanguageSwitcher({ value, onChange, id }: { value: Locale; onChange: (locale: Locale) => void; id?: string }) {
  const t = useT();
  const generated = useId();
  const labelId = `${id ?? generated}-label`;
  return (
    <div className="flex items-center gap-2">
      <Languages className="size-4 text-muted" aria-hidden />
      <span id={labelId} className="sr-only">
        {t('lang.label')}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-full border border-line bg-surface/70 p-1">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={value === locale}
            onClick={() => onChange(locale)}
            className={cx(
              'min-h-9 rounded-full px-3.5 text-sm font-medium transition',
              value === locale ? 'bg-brand text-bg shadow-glow' : 'text-muted hover:text-ink',
            )}
          >
            {t(`lang.${locale}`)}
          </button>
        ))}
      </div>
    </div>
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
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('welcome.form.color')}>
        {accentPresets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset === fallback ? null : preset)}
            aria-label={preset}
            aria-pressed={current === preset.toUpperCase()}
            className={cx(
              'size-10 rounded-full ring-2 ring-offset-2 ring-offset-surface transition hover:scale-105',
              current === preset.toUpperCase() ? 'ring-ink' : 'ring-transparent',
            )}
            style={{ background: preset }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-token border border-line" style={{ background: current }}>
          <span className="sr-only">{t('welcome.form.color')}</span>
          <input
            type="color"
            value={current.toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <input
          id={id}
          aria-label={t('welcome.form.colorHex')}
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
          className="min-h-11 w-32 rounded-token border border-line bg-bg/60 px-3 font-mono text-sm uppercase text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {value !== null && (
          <Button variant="ghost" onClick={() => onChange(null)} icon={<RotateCcw className="size-4" aria-hidden />}>
            {t('welcome.form.resetColor')}
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
        className="glass pointer-events-auto mx-auto flex max-w-3xl animate-fade-up items-center gap-3 border-primary/40 px-4 py-3 shadow-glow"
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

/** Accessible modal confirmation dialog built on <dialog>. */
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
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="glass m-auto w-[min(92vw,420px)] p-6 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-sm open:animate-fade-up"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} autoFocus>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
