import { ALLOWED_HERO_IMG_HOSTS } from "@/features/draft/constants";

interface HeroIconProps {
  imgUrl: string;
  alt: string;
  size?: number;
}

function isAllowedHeroImgHost(imgUrl: string): boolean {
  try {
    return ALLOWED_HERO_IMG_HOSTS.includes(new URL(imgUrl).host);
  } catch {
    return false;
  }
}

interface HeroIconFallbackProps {
  alt: string;
  size: number;
}

function HeroIconFallback({ alt, size }: HeroIconFallbackProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className="flex items-center justify-center rounded-md border border-surface-border bg-surface-overlay text-content-muted text-caption"
      style={{ width: size, height: size }}
    >
      ?
    </div>
  );
}

// Requisito duro (web.md/security.md): valida que el host esté en la lista permitida del CDN de
// Valve antes de renderizar — nunca una URL arbitraria tomada directo de la respuesta de la API.
export function HeroIcon({ imgUrl, alt, size = 48 }: HeroIconProps) {
  if (!isAllowedHeroImgHost(imgUrl)) {
    return <HeroIconFallback alt={alt} size={size} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- host ya validado arriba, dominio externo (CDN de Valve)
    <img
      src={imgUrl}
      alt={alt}
      width={size}
      height={size}
      className="rounded-md border border-surface-border object-cover"
    />
  );
}
