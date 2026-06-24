import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import {
  faUser,
  faKey,
  faLock,
  faGlobe,
  faEnvelope,
  faPhone,
  faCreditCard,
  faCalendar,
  faLocationDot,
  faBriefcase,
  faNoteSticky,
  faEye,
  faEyeSlash,
  faCircleInfo,
  faTriangleExclamation,
  faArrowsRotate,
  faPlus,
  faDice,
  faTag,
  faGear,
  faTrashCan,
  faChevronLeft,
  faXmark,
  faStar as faStarSolid,
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';

// Single icon abstraction for the whole popup. We render Font Awesome's icon path
// data as our own inline <svg> (rather than via @fortawesome/react-fontawesome +
// fontawesome-svg-core) so nothing touches innerHTML/outerHTML — matching the
// project's standing decision to keep the DOM static and avoid AMO's unsafe-HTML
// warnings. The icon packages are pure data; IconDefinition is a type-only import
// (erased at build), so the core renderer never enters the bundle. Icons fill
// `currentColor`, inheriting text color and dark mode automatically.

const ICONS: Record<string, IconDefinition> = {
  // Item-type / field icons
  user: faUser,
  key: faKey,
  lock: faLock,
  globe: faGlobe,
  mail: faEnvelope,
  phone: faPhone,
  card: faCreditCard,
  calendar: faCalendar,
  pin: faLocationDot,
  briefcase: faBriefcase,
  note: faNoteSticky,
  eye: faEye,
  'eye-off': faEyeSlash,
  info: faCircleInfo,
  alert: faTriangleExclamation,
  // UI / action icons
  refresh: faArrowsRotate,
  add: faPlus,
  dice: faDice,
  tag: faTag,
  settings: faGear,
  trash: faTrashCan,
  back: faChevronLeft,
  close: faXmark,
  star: faStarSolid,
  'star-outline': faStarRegular,
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name?: string;
  size?: number;
  className?: string;
}) {
  const def = ICONS[name ?? ''] ?? faCircleInfo;
  const [width, height, , , path] = def.icon;
  // svgPathData is a string for solid/regular styles (an array only for duotone).
  const d = Array.isArray(path) ? path[path.length - 1] : path;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      style={{ verticalAlign: '-0.125em' }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
