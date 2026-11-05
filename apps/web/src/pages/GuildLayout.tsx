import type { GuildOverview } from '@shifubot/shared';
import { CaretUpDown, SignOut, SquaresFour } from '@phosphor-icons/react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useBlocker, useLocation, useMatch, useParams } from 'react-router';
import { featurePages } from '../features';
import { useAuth } from '../lib/auth';
import { usePermissionReport } from '../lib/use-permissions';
import { GuildContext, type GuildContextValue } from '../lib/guild';
import { errorText, I18nProvider, useT } from '../lib/i18n';
import { useApi } from '../lib/use-api';
import { Button as UiButton } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, Avatar, Button, Card, cx, Logo, Skeleton } from '../ui/primitives';
import { Icon } from '../ui/icon';
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
  const { pathname } = useLocation();
  const bottomNav = useRef<HTMLUListElement>(null);
  const [navEdges, setNavEdges] = useState({ start: false, end: false });

  // Mobile bottom bar: more items than fit, so keep the current page in view and fade the edges that scroll.
  const updateNavEdges = useCallback(() => {
    const list = bottomNav.current;
    if (!list) return;
    const start = list.scrollLeft > 4;
    const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 4;
    setNavEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    const list = bottomNav.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && active) {
      const left = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, left), behavior: 'instant' as ScrollBehavior });
    }
    updateNavEdges();
  }, [pathname, updateNavEdges]);
  useEffect(() => {
    window.addEventListener('resize', updateNavEdges);
    return () => window.removeEventListener('resize', updateNavEdges);
  }, [updateNavEdges]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const setSidebarOpen = (open: boolean) => {
    setCollapsed(!open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1');
    } catch {
      // Storage can be unavailable (private mode). The toggle still works for this visit.
    }
  };

  const base = `/guilds/${guild.id}`;
  const items: NavItem[] = [
    { to: base, label: t('nav.overview'), icon: <Icon name="overview" />, end: true },
    ...featurePages.map((feature) => ({
      to: `${base}/features/${feature.id}`,
      label: t(`${feature.id}.name` as 'welcome.name'),
      icon: <Icon name={feature.icon} />,
    })),
    { to: `${base}/settings`, label: t('nav.settings'), icon: <Icon name="settings" /> },
  ];

  const stableSetDirty = useCallback((value: boolean) => setDirty(value), []);
  const context = useMemo<GuildContextValue>(
    () => ({ guild, reload, setDirty: stableSetDirty, permissions }),
    [guild, reload, stableSetDirty, permissions],
  );

  return (
    <GuildContext.Provider value={context}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        {t('common.skipToContent')}
      </a>
      <SidebarProvider open={!collapsed} onOpenChange={(open) => setSidebarOpen(open)}>
        {/* Desktop sidebar (shadcn/ui Sidebar, collapses to icons) */}
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="flex h-12 items-center gap-3 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                  <Logo size={30} />
                  <span className="text-lg font-semibold group-data-[collapsible=icon]:hidden">ShifuBot</span>
                </div>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg" tooltip={t('nav.servers')} className="border bg-card hover:bg-accent/60">
                  <Link to="/guilds">
                    <Avatar src={guild.iconUrl} name={guild.name} size={32} />
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate font-semibold">{guild.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{t('nav.servers')}</span>
                    </span>
                    <CaretUpDown className="ml-auto text-muted-foreground" aria-hidden />
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <nav aria-label={t('nav.main')} className="contents">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarNavItem item={items[0]!} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel className="text-[11px] uppercase tracking-[0.08em] text-subtle">{t('overview.features')}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.slice(1, -1).map((item) => (
                      <SidebarNavItem key={item.to} item={item} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup className="mt-auto">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarNavItem item={items.at(-1)!} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </nav>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="flex items-center gap-2 p-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:p-0">
                  {me && <Avatar src={me.user.avatarUrl} name={me.user.username} size={32} />}
                  <span className="min-w-0 flex-1 truncate text-sm group-data-[collapsible=icon]:hidden">{me?.user.globalName ?? me?.user.username}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-9" onClick={() => void logout()} aria-label={t('common.logout')}>
                        <SignOut aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{t('common.logout')}</TooltipContent>
                  </Tooltip>
                </div>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-w-0">
          {/* Desktop top bar with the collapse button */}
          <header className="sticky top-0 z-30 hidden h-12 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:flex">
            <SidebarTrigger aria-label={collapsed ? t('nav.expand') : t('nav.collapse')} />
          </header>
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur md:hidden">
            <Link to="/guilds" className="flex min-w-0 items-center gap-3" aria-label={t('nav.servers')}>
              <Avatar src={guild.iconUrl} name={guild.name} size={34} />
              <span className="truncate font-semibold">{guild.name}</span>
            </Link>
            <Button variant="ghost" size="icon" className="ml-auto" onClick={() => void logout()} aria-label={t('common.logout')}>
              <SignOut className="size-5" aria-hidden />
            </Button>
          </header>

          <div id="main" className="@container mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 md:pb-12 lg:px-10 lg:pt-8">
            {/* The overview shows the full permission card instead. */}
            {!onOverview && (
              <div className="mb-6 empty:hidden">
                <PermissionCheck variant="banner" />
              </div>
            )}
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul
          ref={bottomNav}
          onScroll={updateNavEdges}
          className={cx(
            'mx-auto flex max-w-2xl overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            navEdges.start && navEdges.end
              ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]'
              : navEdges.end
                ? '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]'
                : navEdges.start && '[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]',
          )}
        >
          {items.map((item) => (
            <li key={item.to} className="min-w-[4.75rem] flex-1 shrink-0">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition',
                    isActive ? 'text-brand' : 'text-muted-foreground',
                  )
                }
              >
                <span className="text-xl">{item.icon}</span>
                <span className="max-w-full truncate px-1">{item.label}</span>
              </NavLink>
            </li>
          ))}
          <li className="min-w-[4.75rem] flex-1 shrink-0">
            <Link to="/guilds" className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
              <SquaresFour className="size-5" aria-hidden />
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
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

function LayoutSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-64 border-r p-3 md:block">
        <Skeleton className="mb-6 h-9 w-36" />
        <Skeleton className="mb-6 h-16 w-full rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-10">
        <PageSkeleton />
      </div>
    </div>
  );
}

function CenteredError({ error }: { error: unknown }) {
  const t = useT();
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-md space-y-4">
        <Alert tone="danger">{errorText(t, error)}</Alert>
        <UiButton asChild className="min-h-11">
          <Link to="/guilds">{t('nav.servers')}</Link>
        </UiButton>
      </Card>
    </div>
  );
}

/** One entry of the sidebar: a shadcn/ui SidebarMenuButton around a router link. */
function SidebarNavItem({ item }: { item: NavItem }) {
  const active = useMatch({ path: item.to, end: item.end ?? false });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={Boolean(active)} tooltip={item.label} className="h-9">
        <NavLink to={item.to} end={item.end}>
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
