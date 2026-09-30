// Admin-set display name when present, otherwise the login email.
export function userLabel(u: { email: string; displayName?: string | null }) {
  return u.displayName?.trim() || u.email;
}

function initials(u: { email: string; displayName?: string | null }) {
  const src = userLabel(u).replace(/@.*/, '');
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

// Initials avatar, or the uploaded photo when there is one.
export function UserAvatar({
  user,
  size = 28,
}: {
  user: { email: string; displayName?: string | null; avatarUrl?: string | null };
  size?: number;
}) {
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full bg-blue-600/10 text-blue-700 font-semibold border border-blue-600/20"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(user)}
    </span>
  );
}
