import { emoji } from '@shifubot/shared';
import { useT } from '../lib/i18n';
import { Badge, Card } from '../ui/primitives';

export function UpcomingPage() {
  const t = useT();
  const ideas = [t('upcoming.ideaRoles'), t('upcoming.ideaLogs'), t('upcoming.ideaLeveling')];
  return (
    <div className="animate-fade-up space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <span aria-hidden>{emoji.soon} </span>
          {t('upcoming.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">{t('upcoming.body')}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {ideas.map((idea) => (
          <li key={idea}>
            <Card as="div" className="flex items-center justify-between gap-4 opacity-80">
              <span className="font-medium">{idea}</span>
              <Badge tone="primary">{t('common.comingSoon')}</Badge>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
