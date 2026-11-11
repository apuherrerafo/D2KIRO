import { HeroIcon as CanonicalHeroIcon } from "@/design/canonical/hero-media/HeroIcon";

interface HeroIconProps {
  imgUrl: string;
  alt: string;
  size?: number;
}

// Requisito duro (web.md/security.md): todo héroe se muestra con su ícono oficial, y el host de la imagen se valida contra
// la lista permitida del CDN de Valve antes de renderizar -- nunca una URL arbitraria tomada de la respuesta de la API.
// La pieza es el HeroIcon canónico del Design System: este componente solo conserva la firma que usan las pantallas del
// producto (`imgUrl`, `alt`, `size`), no dibuja nada propio. Sin imagen válida, el DS muestra su estado neutro (la inicial).
export function HeroIcon({ imgUrl, alt, size = 48 }: HeroIconProps) {
  return <CanonicalHeroIcon imgUrl={imgUrl} name={alt} alt={alt} size={size} />;
}
