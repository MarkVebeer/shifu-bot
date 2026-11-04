import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useParams } from 'react-router';
import { featurePages, memberPages } from './features';
import { AuthProvider, RequireAuth, useAuth } from './lib/auth';
import { CookieLanguageProvider } from './lib/i18n';
import { GuildLayout, PageSkeleton } from './pages/GuildLayout';
import { GuildPickerPage } from './pages/GuildPickerPage';
import { LoginPage } from './pages/LoginPage';
import { FeatureNotFound, NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { MemberShell } from './ui/member-shell';
import { Skeleton } from './ui/primitives';
import { ToastProvider } from './ui/toast';

function Root() {
  return (
    <CookieLanguageProvider>
      <ToastProvider>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      </ToastProvider>
    </CookieLanguageProvider>
  );
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <FullSkeleton />;
  return <Navigate to={me ? '/guilds' : '/login'} replace />;
}

function FullSkeleton() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <Skeleton className="size-16 rounded-full" />
    </div>
  );
}

/** A feature's page for every member of a server, without the dashboard around it. */
function MemberPageRoute() {
  const { guildId = '', featureId = '' } = useParams();
  if (!memberPages.some((item) => item.id === featureId)) return <NotFoundPage />;
  return <MemberShell guildId={guildId} featureId={featureId} />;
}

function FeatureRoute() {
  const { featureId } = useParams();
  const feature = featurePages.find((item) => item.id === featureId);
  if (!feature) return <FeatureNotFound />;
  return <feature.Page />;
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/login', element: <LoginPage /> },
      {
        path: '/guilds',
        element: (
          <RequireAuth fallback={<FullSkeleton />}>
            <GuildPickerPage />
          </RequireAuth>
        ),
      },
      {
        path: '/guilds/:guildId',
        element: (
          <RequireAuth fallback={<FullSkeleton />}>
            <GuildLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'features/:featureId', element: <FeatureRoute /> },
          { path: 'settings', element: <SettingsPage /> },
          // Rendered by GuildLayout as the setup wizard.
          { path: 'setup', element: null },
        ],
        hydrateFallbackElement: <PageSkeleton />,
      },
      { path: '/servers/:guildId/:featureId', element: <MemberPageRoute /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
