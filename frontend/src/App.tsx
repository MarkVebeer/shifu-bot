import { useEffect, useMemo, useState } from 'react';
import { ToastViewport, useDashboardToasts } from './lib/toasts';
import { DashboardAccountMenu } from './components/DashboardAccountMenu';

type AuthUser = {
  id: string;
  username?: string;
  displayName?: string;
  global_name?: string;
  avatar?: string | null;
};

type DashboardGuild = {
  id: string;
  name: string;
  icon: string | null;
  inBotGuild: boolean;
  dashboardUrl: string;
};

type AppRoute =
  | { kind: 'home' }
  | { kind: 'guild'; guildId: string };

function parseRoute(pathname: string): AppRoute {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  if (normalizedPath.startsWith('/dashboard/guild/')) {
    return {
      kind: 'guild',
      guildId: normalizedPath.slice('/dashboard/guild/'.length)
    };
  }

  return { kind: 'home' };
}

function HomeDashboardPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [guilds, setGuilds] = useState<DashboardGuild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      const meResponse = await fetch('/api/auth/me');
      const meData = (await meResponse.json()) as { user: AuthUser | null };

      if (cancelled) {
        return;
      }

      setUser(meData.user);

      if (!meData.user) {
        setLoading(false);
        return;
      }

      const guildsResponse = await fetch('/api/auth/guilds');

      if (cancelled) {
        return;
      }

      if (guildsResponse.ok) {
        const guildsData = (await guildsResponse.json()) as { guilds: DashboardGuild[] };
        setGuilds(guildsData.guilds);
      }

      setLoading(false);
    }

    loadDashboard().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const connectedGuilds = useMemo(() => guilds.filter((guild) => guild.inBotGuild), [guilds]);

  if (loading) {
    return (
      <main className="shell shell--dashboard">
        <section className="panel panel--loading">Loading dashboard...</section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="shell shell--dashboard">
        <section className="panel dashboard-hero dashboard-hero--auth">
          <p className="eyebrow">Shifu Bot Dashboard</p>
          <h1>Sign in to continue</h1>
          <p className="lead">Authenticate with Discord to see your servers and manage where the bot lives.</p>
          <div className="actions">
            <a className="primary" href="/auth/discord">
              Sign in with Discord
            </a>
            <a className="secondary" href="/api/health">
              Health check
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell shell--dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">Shifu Bot Dashboard</p>
          <h1>Home</h1>
        </div>
        <DashboardAccountMenu user={user} />
      </header>

      <section className="dashboard-grid">
        <article className="panel dashboard-hero">
          <p className="eyebrow">Welcome back</p>
          <h1>Select a server or invite the bot</h1>
          <p className="lead">
            Manage the servers where Shifu Bot is already present, or add it to a server you can administer.
          </p>
          <div className="actions">
            <a className="primary" href="/auth/discord/invite">
              Add Shifu Bot to Discord
            </a>
            <a className="secondary" href="/api/health">
              Health check
            </a>
          </div>
        </article>

        <section className="panel section-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Connected servers</p>
              <h2>Open a dashboard</h2>
            </div>
            <span className="section-count">{connectedGuilds.length}</span>
          </div>

          <div className="guild-list">
            {connectedGuilds.length ? (
              connectedGuilds.map((guild) => (
                <a key={guild.id} className="guild-card guild-card--active" href={guild.dashboardUrl}>
                  <div className="guild-card__icon">{guild.name.slice(0, 1).toUpperCase()}</div>
                  <div className="guild-card__body">
                    <strong>{guild.name}</strong>
                    <span>Bot is already in this server</span>
                  </div>
                  <span className="guild-card__action">Open</span>
                </a>
              ))
            ) : (
              <p className="empty-state">The bot is not in any servers you can manage yet.</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function ServerDashboardPage({ guildId, notify }: { guildId: string; notify: (tone: 'success' | 'error' | 'info', title: string, message?: string) => void }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [guildName, setGuildName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardHeader() {
      try {
        const [meResponse, featureResponse] = await Promise.all([
          fetch('/api/auth/me', { credentials: 'include' }),
          fetch(`/api/features/gta-news/${guildId}`, { credentials: 'include' })
        ]);

        if (!cancelled) {
          if (meResponse.ok) {
            const meData = (await meResponse.json()) as { user: AuthUser | null };
            setUser(meData.user ?? null);
          }

          if (featureResponse.ok) {
            const featureData = (await featureResponse.json()) as { guildName: string | null };
            setGuildName(featureData.guildName ?? null);
          }
        }
      } catch {
        // Header state is best-effort; the card will still load independently.
      }
    }

    loadDashboardHeader();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell shell--dashboard">
      <header className="topbar topbar--server">
        <div>
          <p className="eyebrow">Shifu Bot Dashboard</p>
          <h1>Server dashboard{guildName ? ` · ${guildName}` : ''}</h1>
        </div>
        <div className="topbar__actions">
          {user ? (
            <DashboardAccountMenu user={user} showBackHome />
          ) : (
            <span className="status-pill status-pill--warning">Sign-in required</span>
          )}
        </div>
      </header>

      <section className="panel server-stage" aria-label={`Server dashboard for ${guildId}`}>
        <div className="server-stage-grid">
          <GtaNewsSettingsPanel guildId={guildId} notify={notify} onGuildNameLoaded={setGuildName} />
        </div>
      </section>
    </main>
  );
}

function GtaNewsSettingsPanel({
  guildId,
  notify,
  onGuildNameLoaded
}: {
  guildId: string;
  notify: (tone: 'success' | 'error' | 'info', title: string, message?: string) => void;
  onGuildNameLoaded?: (guildName: string | null) => void;
}) {
  const [input, setInput] = useState('');
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/features/gta-news/${guildId}`, { credentials: 'include' });
        if (!res.ok) {
          throw new Error('Failed to load settings');
        }
        const data = await res.json();
        if (cancelled) return;
        const settings = data.settings;
        onGuildNameLoaded?.(data.guildName ?? null);
        setInput(settings?.channelId ?? '');
        // load current user
        try {
          const meRes = await fetch('/api/auth/me', { credentials: 'include' });
          if (meRes.ok) {
            const meData = await meRes.json();
            setMe(meData.user ?? null);
          }
        } catch (err) {
          console.warn('Failed to load current user', err);
        }
        // load available channels for dropdown
        try {
          const chRes = await fetch(`/api/features/gta-news/${guildId}/channels`, { credentials: 'include' });
          if (chRes.ok) {
            const chData = await chRes.json();
            setChannels(chData.channels ?? []);
          }
        } catch (err) {
          console.warn('Failed to load channels', err);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [guildId, onGuildNameLoaded]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    if (!me) {
      notify('error', 'Sign-in required', 'You must be signed in to save settings.');
      setSaving(false);
      return;
    }
    try {
      const res = await fetch(`/api/features/gta-news/${guildId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: input, setterId: me?.id, setterName: me?.displayName ?? me?.username })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Save failed');
      }

      notify('success', 'GTA News saved', 'The forum channel was updated successfully.');
    } catch (err: any) {
      console.error(err);
      notify('error', 'Save failed', err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="gta-news-card">
      {loading ? (
        <div className="gta-news-card__body">
          <p className="gta-news-card__loading">Loading settings…</p>
        </div>
      ) : (
        <>
          <div className="gta-news-card__header">
            <div>
              <h3>GTA News</h3>
            </div>
          </div>

          <form className="gta-news-form" onSubmit={handleSave}>
            {!me ? (
              <div className="gta-news-notice">
                <p className="gta-news-notice__title">Sign-in required</p>
                <p className="muted">
                  You are not signed in. Please <a href="/auth/discord">Sign in with Discord</a> to save settings.
                </p>
              </div>
            ) : null}

            <label className="gta-news-field">
              <span>Forum channel</span>
              <select
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="select gta-news-select"
              >
                <option value="">— choose a forum channel —</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="gta-news-field__hint">
                Weekly GTA Online updates will create a new forum post in this channel.
              </span>
            </label>

            <div className="gta-news-actions">
              <button className="primary gta-news-save-button" type="submit" disabled={saving || !me}>
                {saving ? 'Saving…' : 'Save forum channel'}
              </button>
            </div>

          </form>
        </>
      )}
    </article>
  );
}

export default function App() {
  const route = parseRoute(window.location.pathname);
  const { toasts, pushToast, dismissToast } = useDashboardToasts();

  const notify = (tone: 'success' | 'error' | 'info', title: string, message?: string) => {
    pushToast({ tone, title, message });
  };

  if (route.kind === 'guild') {
    return (
      <>
        <ServerDashboardPage guildId={route.guildId} notify={notify} />
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <>
      <HomeDashboardPage />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
