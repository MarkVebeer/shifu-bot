import { Link } from 'react-router';
import { useT } from '../lib/i18n';

export function NotFoundPage() {
  const t = useT();
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-md animate-fade-up p-10 text-center">
        <p className="font-mono text-6xl font-bold text-gradient">404</p>
        <h1 className="mt-4 text-xl font-semibold">{t('errors.notFound')}</h1>
        <p className="mt-2 text-muted">{t('errors.notFoundBody')}</p>
        <Link
          to="/"
          className="mt-8 inline-flex min-h-11 items-center rounded-full bg-brand px-6 text-sm font-semibold text-bg shadow-glow"
        >
          {t('errors.goHome')}
        </Link>
      </div>
    </main>
  );
}

export function FeatureNotFound() {
  const t = useT();
  return <p className="text-muted">{t('errors.notFoundBody')}</p>;
}
