import { emoji, type GuildOverview } from '@shifubot/shared';
import { ChevronsLeft, ChevronsRight, LayoutGrid, LogOut } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useBlocker, useMatch, useParams } from 'react-router';
import { featurePages } from '../features';
import { useAuth } from '../lib/auth';
import { usePermissionReport } from '../lib/use-permissions';
import { GuildContext, type GuildContextValue } from '../lib/guild';
import { errorText, I18nProvider, useT } from '../lib/i18n';
import { useApi } from '../lib/use-api';
import { Alert, Avatar, Button, cx, Logo, Skeleton } from '../ui/primitives';
import { PermissionCheck } from '../ui/permission-check';
import { ConfirmDialog } from '../ui/widgets';
import { SetupWizard } from './SetupWizard';

const SIDEBAR_KEY = 'shifu_sidebar_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function GuildLayout() {
  const { guildId = '' } = useParams();
  const { data, error, loading, reload } = useApi<GuildOverview>(`/guilds/${guildId}/overview`);
  const setupRoute = useMatch('/guilds/:guildId/setup');

  if (error) return <CenteredError error={error} />;
  if (loading && !data) return <LayoutSkeleton />;
  if (!data) return null;
  // A server without finished setup (bot just joined, or no config yet) always lands in the wizard.
  if (!data.setupCompleted || setupRoute) {
    return <SetupWizard guild={data} reload={reload} rerun={data.setupCompleted} />;
  }
  return (
    <I18nProvider locale={data.locale}>
      <GuildShell guild={data} reload={reload} />
    </I18nProvider>
  );
}

function GuildShell({ guild, reload }: { guild: GuildOverview; reload: () => Promise<void> }) {
  const t = useT();
  const { me, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [dirty, setDirty] = useState(false);
  const permissions = usePermissionReport(guild.id);
  const onOverview = useMatch('/guilds/:guildId');

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const toggleSidebar = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, value ? '0' : '1');
      } catch {
        // Storage can be unavailable (private mode). The toggle still works for this visit.
      }
      return !value;
    });
  };

  const base = `/guilds/${guild.id}`;
  const items: NavItem[] = [
    { to: base, label: t('nav.overview'), icon: <span aria-hidden>{emoji.overview}</span>, end: true },
    ...featurePages.map((feature) => ({
      to: `${base}/features/${feature.id}`,
      label: t(`${feature.id}.name` as 'welcome.name'),
      icon: <span aria-hidden>{feature.emoji}</span>,
    })),
    { to: `${base}/settings`, label: t('nav.settings'), icon: <span aria-hidden>{emoji.settings}</span> },  ];

  const stableSetDirty = useCallback((value: boolean) => setDirty(value), []);
  const context = useMemo<GuildContextValue>(
    () => ({ guild, reload, setDirty: stableSetDirty, permissions }),
    [guild, reload, stableSetDirty, permissions],
  );

  return (
    <GuildContext.Provider value={context}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-bg">
        {t('common.skipToContent')}
      </a>
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside
          className={cx(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line/60 bg-surface/50 backdrop-blur-xl transition-[width] duration-300 lg:flex',
            collapsed ? 'w-20' : 'w-72',
          )}
        >
          <div className={cx('flex items-center gap-3 px-5 py-5', collapsed && 'justify-center px-0')}>
            <Logo size={34} />
            {!collapsed && <span className="text-lg font-semibold">ShifuBot</span>}
          </div>
          <Link
            to="/guilds"
            className={cx(
              'glass-raised glow-hover mx-3 mb-4 flex items-center gap-3 p-3',
              collapsed && 'justify-center p-2',
            )}
            title={t('nav.servers')}
          >
            <Avatar src={guild.iconUrl} name={guild.name} size={collapsed ? 36 : 40} />
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{guild.name}</p>
                <p className="text-xs text-muted">{t('nav.servers')}</p>
              </div>
            )}
          </Link>
          <nav aria-label={t('nav.main')} className="flex-1 space-y-1 overflow-y-auto px-3">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-11 items-center gap-3 rounded-token px-3 text-sm font-medium transition',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-brand-soft text-ink ring-1 ring-primary/30' : 'text-muted hover:bg-raised/60 hover:text-ink',
                  )
                }
              >
                <span className="text-lg">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </nav>
          <div className={cx('flex items-center gap-2 border-t border-line/60 p-3', collapsed && 'flex-col')}>
            {me && <Avatar src={me.user.avatarUrl} name={me.user.username} size={36} />}
            {!collapsed && <span className="min-w-0 flex-1 truncate text-sm">{me?.user.globalName ?? me?.user.username}</span>}
            <Button variant="ghost" size="icon" onClick={logout} aria-label={t('common.logout')} title={t('common.logout')}>
              <LogOut className="size-5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-expanded={!collapsed}
              title={collapsed ? t('nav.expand') : t('nav.collapse')}
            >
              {collapsed ? <ChevronsRight className="size-5" aria-hidden /> : <ChevronsLeft className="size-5" aria-hidden />}
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line/60 bg-bg/75 px-4 py-3 backdrop-blur-xl lg:hidden">
            <Link to="/guilds" className="flex min-w-0 items-center gap-3" aria-label={t('nav.servers')}>
              <Avatar src={guild.iconUrl} name={guild.name} size={34} />
              <span className="truncate font-semibold">{guild.name}</span>
            </Link>
            <Button variant="ghost" size="icon" className="ml-auto" onClick={logout} aria-label={t('common.logout')}>
              <LogOut className="size-5" aria-hidden />
            </Button>
          </header>

          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
            {/* The overview shows the full permission card instead. */}
            {!onOverview && (
              <div className="mb-6 empty:hidden">
                <PermissionCheck variant="banner" />
              </div>
            )}
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg">
          {items.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition',
                    isActive ? 'text-primary' : 'text-muted',
                  )
                }
              >
                <span className="text-xl">{item.icon}</span>
                <span className="max-w-full truncate px-1">{item.label}</span>
              </NavLink>
            </li>
          ))}
          <li className="flex-1">
            <Link to="/guilds" className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted">
              <LayoutGrid className="size-5" aria-hidden />
              <span>{t('nav.servers')}</span>
            </Link>
          </li>
        </ul>
      </nav>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={t('common.leaveTitle')}
        body={t('common.leaveBody')}
        confirmLabel={t('common.leave')}
        cancelLabel={t('common.stay')}
        onConfirm={() => {
          setDirty(false);
          blocker.proceed?.();
        }}
        onCancel={() => blocker.reset?.()}
      />
    </GuildContext.Provider>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-4 pt-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    </div>
  );
}

function LayoutSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-72 border-r border-line/60 p-5 lg:block">
        <Skeleton className="mb-6 h-9 w-36" />
        <Skeleton className="mb-6 h-16 w-full rounded-panel" />
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
      <div className="flex-1 p-6 lg:p-10">
        <PageSkeleton />
      </div>
    </div>
  );
}

function CenteredError({ error }: { error: unknown }) {
  const t = useT();
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-md space-y-4 p-6">
        <Alert tone="danger">{errorText(t, error)}</Alert>
        <Link to="/guilds" className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-bg">
          {t('nav.servers')}
        </Link>
      </div>
    </div>
  );
}
