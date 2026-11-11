// Avatar público de Steam (https, tamaño fijo) o, si no hay, la inicial de la marca. Sin avatar nunca queda un hueco.
export function AccountAvatar({ avatarUrl }: { avatarUrl: string | null }) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- avatar público de Steam, tamaño fijo, sin optimización de Next
    return <img src={avatarUrl} alt="" className="ap-avatar" />;
  }
  return (
    <span aria-hidden="true" className="ap-avatar ap-avatar--empty">
      D
    </span>
  );
}
