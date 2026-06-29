type AccountUser = {
  id: string;
  username?: string;
  displayName?: string;
  global_name?: string;
  avatar?: string | null;
};

function getDisplayName(user: AccountUser) {
  return user.displayName ?? user.global_name ?? user.username ?? 'Discord user';
}

function getAvatarUrl(user: AccountUser) {
  if (!user.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function MenuIcon() {
  return (
    <span className="menu-icon" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function DashboardAccountMenu({ user, showBackHome = false }: { user: AccountUser; showBackHome?: boolean }) {
  const avatarUrl = getAvatarUrl(user);

  return (
    <details className="account-menu">
      <summary className="profile-chip account-menu__trigger">
        {avatarUrl ? <img alt="" className="profile-chip__avatar" src={avatarUrl} /> : null}
        <span className="account-menu__name">{getDisplayName(user)}</span>
        <MenuIcon />
      </summary>

      <div className="account-menu__panel" role="menu" aria-label="Account actions">
        {showBackHome ? (
          <a className="account-menu__item" href="/dashboard" role="menuitem">
            Back to home
          </a>
        ) : null}
        <a className="account-menu__item account-menu__item--danger" href="/auth/logout" role="menuitem">
          Log out
        </a>
      </div>
    </details>
  );
}