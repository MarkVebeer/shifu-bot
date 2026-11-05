/**
 * The dashboard's icon set. Every icon comes from lucide-react and draws in
 * `currentColor`, so it follows the monochrome text color. The names match the
 * shared emoji set, so a feature or section that names an emoji for Discord
 * gets the matching line icon in the dashboard.
 */
import type { EmojiName } from '@shifubot/shared';
import {
  CircleCheck,
  ClipboardList,
  Compass,
  DoorOpen,
  Flame,
  FlaskConical,
  Globe,
  Hand,
  Info,
  MessageSquare,
  Mic,
  OctagonX,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

export const icons: Record<EmojiName, LucideIcon> = {
  welcome: Hand,
  goodbye: DoorOpen,
  verification: ShieldCheck,
  leveling: Trophy,
  chat: MessageSquare,
  voice: Mic,
  overall: Star,
  success: CircleCheck,
  warning: TriangleAlert,
  error: OctagonX,
  info: Info,
  sparkle: Sparkles,
  test: FlaskConical,
  log: ClipboardList,
  goon: Flame,
  globe: Globe,
  overview: Compass,
  settings: Settings,
  rocket: Rocket,
};

export function Icon({ name, size = 18, className }: { name: EmojiName; size?: number; className?: string }) {
  const Component = icons[name];
  return <Component aria-hidden size={size} strokeWidth={1.75} className={className} />;
}
