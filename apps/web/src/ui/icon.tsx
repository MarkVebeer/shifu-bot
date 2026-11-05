/**
 * The dashboard's icon set. Every icon comes from Phosphor (@phosphor-icons/react) and draws in
 * `currentColor`, so it follows the text color. The names match the
 * shared emoji set, so a feature or section that names an emoji for Discord
 * gets the matching line icon in the dashboard.
 */
import type { EmojiName } from '@shifubot/shared';
import { ChatCircle, CheckCircle, ClipboardText, Compass, DoorOpen, Fire, Flask, GearSix, Globe, HandWaving, type Icon as PhosphorIcon, Info, Microphone, Rocket, ShieldCheck, Sparkle, Star, Trophy, Warning, XCircle } from '@phosphor-icons/react';

export const icons: Record<EmojiName, PhosphorIcon> = {
  welcome: HandWaving,
  goodbye: DoorOpen,
  verification: ShieldCheck,
  leveling: Trophy,
  chat: ChatCircle,
  voice: Microphone,
  overall: Star,
  success: CheckCircle,
  warning: Warning,
  error: XCircle,
  info: Info,
  sparkle: Sparkle,
  test: Flask,
  log: ClipboardText,
  goon: Fire,
  globe: Globe,
  overview: Compass,
  settings: GearSix,
  rocket: Rocket,
};

export function Icon({ name, size = 18, className }: { name: EmojiName; size?: number; className?: string }) {
  const Component = icons[name];
  return <Component aria-hidden size={size} className={className} />;
}
