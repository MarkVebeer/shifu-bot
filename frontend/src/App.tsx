export default function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Shifu Bot Dashboard</p>
        <h1>Monolithic Discord bot control center</h1>
        <p className="lead">
          A single-process backend, Discord OAuth2 login, SQLite persistence, and feature-based bot modules.
        </p>
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
