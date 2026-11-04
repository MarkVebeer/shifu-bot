import { emoji, isLocale, type GuildOverview } from '@shifubot/shared';
import { ArrowLeft, ArrowRight, Check, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getTranslator } from '../../../../features';
import { api } from '../lib/api';
import { GuildContext, type GuildContextValue } from '../lib/guild';
import { errorText, I18nProvider, useT } from '../lib/i18n';
import { usePermissionReport } from '../lib/use-permissions';
import { useSetupDrafts } from '../lib/use-setup-drafts';
import { Alert, Avatar, Button, cx, Logo, Skeleton } from '../ui/primitives';
import { useToast } from '../ui/toast';

/**
 * First run setup. Shown automatically while a server has not finished setup
 * (bot just joined, or no config yet), and again from Settings > Run setup again.
 */
export function SetupWizard({ guild, reload, rerun }: { guild: GuildOverview; reload: () => Promise<void>; rerun: boolean }) {
  const setup = useSetupDrafts(guild);
  const draftLocale = (setup.drafts?.language as { locale?: unknown } | undefined)?.locale;
  // The wizard speaks the language picked in the first step right away.
  const locale = isLocale(draftLocale) ? draftLocale : guild.locale;
  const permissions = usePermissionReport(guild.id);
  const context = useMemo<GuildContextValue>(() => ({ guild, reload, setDirty: () => {}, permissions }), [guild, reload, permissions]);

  return (
    <I18nProvider locale={locale}>
      <GuildContext.Provider value={context}>
        <WizardBody guild={guild} reload={reload} rerun={rerun} setup={setup} />
      </GuildContext.Provider>
    </I18nProvider>
  );
}

function WizardBody({
  guild,
  reload,
  rerun,
  setup,
}: {
  guild: GuildOverview;
  reload: () => Promise<void>;
  rerun: boolean;
  setup: ReturnType<typeof useSetupDrafts>;
}) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { sections, drafts } = setup;
  // Step 0 is the intro, then one step per section, then the summary.
  const lastStep = sections.length + 1;
  const [step, setStep] = useState(0);
  const [showProblem, setShowProblem] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const base = `/guilds/${guild.id}`;

  useEffect(() => {
    setShowProblem(false);
    headingRef.current?.focus();
  }, [step]);

  const section = step >= 1 && step <= sections.length ? sections[step - 1] : undefined;
  const problem = section ? setup.problem(section.id) : null;

  const next = () => {
    if (problem) {
      setShowProblem(true);
      return;
    }
    setStep((current) => Math.min(current + 1, lastStep));
  };

  const finish = async () => {
    const invalid = sections.findIndex((item) => setup.problem(item.id));
    if (invalid >= 0) {
      setStep(invalid + 1);
      setShowProblem(true);
      return;
    }
    setFinishing(true);
    try {
      await setup.saveChanged();
      await api(`${base}/setup/complete`, { method: 'POST' });
      const locale = (drafts?.language as { locale: typeof guild.locale }).locale;
      toast.success(getTranslator(locale)('setup.completed'));
      navigate(rerun ? `${base}/settings` : base, { replace: true });
      await reload();
    } catch (error) {
      toast.error(`${t('setup.failed')}: ${errorText(t, error)}`);
    } finally {
      setFinishing(false);
    }
  };

  const progress = Math.round((step / lastStep) * 100);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Logo size={30} />
          <Avatar src={guild.iconUrl} name={guild.name} size={30} />
          <span className="min-w-0 flex-1 truncate font-semibold">{guild.name}</span>
          {rerun ? (
            <Link
              to={`${base}/settings`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm text-muted hover:bg-raised/60 hover:text-ink"
            >
              <X className="size-4" aria-hidden />
              {t('setup.cancel')}
            </Link>
          ) : (
            <Link to="/guilds" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-muted hover:bg-raised/60 hover:text-ink">
              {t('setup.leave')}
            </Link>
          )}
        </div>
        <div
          className="h-1 bg-raised"
          role="progressbar"
          aria-label={t('setup.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-32 pt-8 sm:pb-12 sm:pt-12">
        {setup.error ? (
          <Alert
            tone="danger"
            action={
              <Button variant="secondary" onClick={() => void setup.reload()}>
                {t('common.retry')}
              </Button>
            }
          >
            {errorText(t, setup.error)}
          </Alert>
        ) : !drafts ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        ) : (
          <div key={step} className="animate-fade-up">
            {section && (
              <p className="mb-3 text-sm font-medium text-primary">
                {t('setup.step', { current: step, total: sections.length })}
              </p>
            )}

            {step === 0 && (
              <div className="text-center">
                <div className="mx-auto mb-6 grid size-20 place-items-center rounded-3xl bg-brand-soft text-4xl shadow-glow ring-1 ring-primary/30" aria-hidden>
                  {emoji.rocket}
                </div>
                <p className="mb-2 text-sm font-medium uppercase tracking-wider text-primary">{rerun ? t('setup.rerunBadge') : t('setup.badge')}</p>
                <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none sm:text-3xl">
                  <span className="text-gradient">{t('setup.introTitle')}</span>
                </h1>
                <p className="mx-auto mt-3 max-w-md text-muted">{t('setup.introBody', { server: guild.name })}</p>
                <ol className="mx-auto mt-8 max-w-sm space-y-2 text-left">
                  {sections.map((item, index) => (
                    <li key={item.id} className="glass-raised flex items-center gap-3 px-4 py-3 text-sm">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised font-mono text-xs text-muted">{index + 1}</span>
                      <span aria-hidden>{emoji[item.emoji]}</span>
                      {t(item.title)}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {section && (
              <section aria-labelledby="setup-step-title">
                <h1 id="setup-step-title" ref={headingRef} tabIndex={-1} className="flex items-center gap-3 text-2xl font-bold tracking-tight outline-none sm:text-3xl">
                  <span aria-hidden>{emoji[section.emoji]}</span>
                  {t(section.title)}
                </h1>
                <p className="mt-2 text-muted">{t(section.description)}</p>
                <div className="glass mt-6 p-4 sm:p-6">
                  <section.Component value={drafts[section.id] as never} onChange={(value) => setup.setDraft(section.id, value)} guild={guild} />
                </div>
                {showProblem && problem && (
                  <div className="mt-4">
                    <Alert tone="warning">{t(problem)}</Alert>
                  </div>
                )}
              </section>
            )}

            {step === lastStep && (
              <section aria-labelledby="setup-done-title">
                <h1 id="setup-done-title" ref={headingRef} tabIndex={-1} className="flex items-center gap-3 text-2xl font-bold tracking-tight outline-none sm:text-3xl">
                  <span aria-hidden>{emoji.sparkle}</span>
                  {t('setup.doneTitle')}
                </h1>
                <p className="mt-2 text-muted">{t('setup.doneBody')}</p>
                <ul className="mt-6 space-y-2">
                  {sections.map((item, index) => (
                    <li key={item.id} className="glass-raised flex items-center gap-3 px-4 py-3">
                      <span className="text-xl" aria-hidden>
                        {emoji[item.emoji]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-muted">{t(item.title)}</span>
                        <span className="block font-medium">{item.summary(drafts[item.id] as never, t)}</span>
                      </span>
                      <Button variant="ghost" size="icon" onClick={() => setStep(index + 1)} aria-label={`${t('setup.edit')}: ${t(item.title)}`}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      {drafts && !setup.error && (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-bg/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:static sm:border-0 sm:bg-transparent sm:pb-10 sm:backdrop-blur-none">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep((current) => current - 1)} icon={<ArrowLeft className="size-4" aria-hidden />} disabled={finishing}>
                {t('setup.back')}
              </Button>
            )}
            <div className="flex-1" />
            {step < lastStep ? (
              <Button size="lg" onClick={next} icon={step === 0 ? undefined : <ArrowRight className="size-4" aria-hidden />} className={cx(step === 0 && 'w-full sm:w-auto')}>
                {step === 0 ? t('setup.start') : t('setup.next')}
              </Button>
            ) : (
              <Button size="lg" onClick={() => void finish()} loading={finishing} icon={<Check className="size-4" aria-hidden />}>
                {finishing ? t('setup.finishing') : t('setup.finish')}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
