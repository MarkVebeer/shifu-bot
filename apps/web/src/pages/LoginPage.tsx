import { emoji } from '@shifubot/shared';
import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useCookieLocale, useT } from '../lib/i18n';
import { ButtonLink, Logo } from '../ui/primitives';
import { LanguageSwitcher } from '../ui/widgets';

function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.7 19.7 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.6 19.6 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.5c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.7 8 10.7s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}

export function LoginPage() {
  const t = useT();
  const { me, loading } = useAuth();
  const { locale, setLocale } = useCookieLocale();
  if (!loading && me) return <Navigate to="/guilds" replace />;

  const points = [
    { icon: emoji.welcome, text: t('login.pointWelcome') },
    { icon: emoji.globe, text: t('login.pointLanguages') },
    { icon: emoji.sparkle, text: t('login.pointOpenSource') },
  ];

  return (
    <main className="flex min-h-dvh flex-col px-4 py-6">
      <div className="mx-auto flex w-full max-w-md justify-end">
        <LanguageSwitcher value={locale} onChange={setLocale} />
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="glass w-full max-w-md animate-fade-up p-8 text-center sm:p-10">
          <div className="mx-auto mb-6 grid size-20 place-items-center rounded-3xl bg-brand-soft shadow-glow ring-1 ring-primary/30">
            <Logo size={52} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="text-gradient">{t('login.title')}</span>
          </h1>
          <p className="mt-3 text-muted">{t('login.subtitle')}</p>
          <ul className="mt-7 space-y-2 text-left">
            {points.map((point) => (
              <li key={point.text} className="glass-raised flex items-center gap-3 px-4 py-3 text-sm">
                <span aria-hidden className="text-lg">
                  {point.icon}
                </span>
                {point.text}
              </li>
            ))}
          </ul>
          <ButtonLink href="/auth/login" className="mt-8 w-full min-h-12 text-base" icon={<DiscordGlyph />}>
            {t('login.button')}
          </ButtonLink>
          <p className="mt-4 text-xs leading-relaxed text-muted">{t('login.note')}</p>
        </div>
      </div>
    </main>
  );
}
