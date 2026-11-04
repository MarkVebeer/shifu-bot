import { emoji, isLocale } from '@shifubot/shared';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getTranslator } from '../../../../features';
import { useGuild } from '../lib/guild';
import { errorText, useT } from '../lib/i18n';
import { useSetupDrafts } from '../lib/use-setup-drafts';
import { Alert, Button, Card, CardHeader, Skeleton } from '../ui/primitives';
import { useToast } from '../ui/toast';
import { SaveBar } from '../ui/widgets';

/** Every setting asked during setup, editable in one place. */
export function SettingsPage() {
  const t = useT();
  const toast = useToast();
  const { guild, reload, setDirty, permissions } = useGuild();
  const setup = useSetupDrafts(guild);
  const [saving, setSaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);

  useEffect(() => setDirty(setup.dirty), [setup.dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const save = async () => {
    if (setup.sections.some((section) => setup.problem(section.id))) {
      setShowProblems(true);
      toast.error(t('errors.validation'));
      return;
    }
    setSaving(true);
    try {
      const languageChanged = setup.changed.some((section) => section.id === 'language');
      await setup.saveChanged();
      const locale = (setup.drafts?.language as { locale?: unknown } | undefined)?.locale;
      // After a language change `t` still speaks the old language.
      toast.success(getTranslator(isLocale(locale) ? locale : guild.locale)('toast.saved'));
      setShowProblems(false);
      void permissions.reload();
      if (languageChanged) await reload();
    } catch (error) {
      toast.error(`${t('toast.saveFailed')}: ${errorText(t, error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-up space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <span aria-hidden>{emoji.settings} </span>
          {t('settings.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">{t('settings.description')}</p>
      </header>

      {setup.error ? (
        <Alert tone="danger" action={<Button variant="secondary" onClick={() => void setup.reload()}>{t('common.retry')}</Button>}>
          {errorText(t, setup.error)}
        </Alert>
      ) : !setup.drafts ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-48 rounded-card" />
        </div>
      ) : (
        <form
          className="max-w-3xl space-y-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {setup.sections.map((section) => {
            const problem = showProblems ? setup.problem(section.id) : null;
            const drafts = setup.drafts!;
            return (
              <Card key={section.id}>
                <CardHeader icon={emoji[section.emoji]} title={t(section.title)} description={t(section.description)} />
                <section.Component value={drafts[section.id] as never} onChange={(value) => setup.setDraft(section.id, value)} guild={guild} />
                {problem && (
                  <div className="mt-4">
                    <Alert tone="warning">{t(problem)}</Alert>
                  </div>
                )}
              </Card>
            );
          })}

          <Card>
            <CardHeader icon={emoji.rocket} title={t('settings.rerun')} description={t('settings.rerunHelp')} />
            <Link
              to={`/guilds/${guild.id}/setup`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-raised/70 px-5 text-sm font-semibold transition hover:border-primary/60"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('settings.rerun')}
            </Link>
          </Card>

          <SaveBar visible={setup.dirty} saving={saving} onSave={() => void save()} onDiscard={setup.reset} />
        </form>
      )}
    </div>
  );
}
