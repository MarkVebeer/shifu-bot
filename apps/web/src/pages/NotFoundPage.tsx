import { Link } from 'react-router';
import { Button as UiButton } from '@/components/ui/button';
import { useT } from '../lib/i18n';
import { Card } from '../ui/primitives';

export function NotFoundPage() {
  const t = useT();
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-md animate-fade-up p-10 text-center sm:p-10">
        <p className="font-mono text-6xl font-bold">404</p>
        <h1 className="mt-4 text-xl font-semibold">{t('errors.notFound')}</h1>
        <p className="mt-2 text-muted-foreground">{t('errors.notFoundBody')}</p>
        <UiButton asChild className="mt-8 min-h-11 px-6">
          <Link to="/">{t('errors.goHome')}</Link>
        </UiButton>
      </Card>
    </main>
  );
}

export function FeatureNotFound() {
  const t = useT();
  return <p className="text-muted-foreground">{t('errors.notFoundBody')}</p>;
}
