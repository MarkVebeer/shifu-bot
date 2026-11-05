/**
 * Dashboard helpers: readable names for event types, categories and detail fields.
 */
import type { AppMessageKey } from '..';
import type { TFunction } from '../../apps/web/src/lib/i18n';
import {
  Bot,
  CalendarDays,
  Drama,
  Gavel,
  Hash,
  House,
  Mail,
  MessageSquare,
  MessagesSquare,
  Plug,
  ShieldAlert,
  Smile,
  Users,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { categoryOf, type AuditCategory } from './manifest';

/** Dashboard icon per category. Discord messages keep CATEGORY_EMOJI from the manifest. */
export const CATEGORY_ICON: Record<AuditCategory, LucideIcon> = {
  moderation: Gavel,
  members: Users,
  messages: MessageSquare,
  voice: Volume2,
  channels: Hash,
  threads: MessagesSquare,
  roles: Drama,
  invites: Mail,
  expressions: Smile,
  events: CalendarDays,
  automod: ShieldAlert,
  integrations: Plug,
  server: House,
  shifubot: Bot,
};

/** "MemberBanAdd" → "Member ban add", for types or fields without a translation. */
export function humanize(value: string): string {
  const words = value
    .replace(/^audit\./, '')
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function translated(t: TFunction, key: string): string | null {
  const text = t(key as AppMessageKey);
  return text && text !== key ? text : null;
}

export function typeLabel(t: TFunction, type: string): string {
  return translated(t, `audit.types.${type}`) ?? humanize(type);
}

export function categoryLabel(t: TFunction, category: AuditCategory): string {
  return translated(t, `audit.categories.${category}`) ?? humanize(category);
}

export function fieldLabel(t: TFunction, key: string): string {
  return translated(t, `audit.fields.${key}`) ?? humanize(key);
}

/** A category's line icon, white by default through currentColor. */
export function CategoryIcon({ category, className }: { category: AuditCategory; className?: string }) {
  return createElement(CATEGORY_ICON[category], { className, 'aria-hidden': true });
}

export function typeIcon(type: string): LucideIcon {
  return CATEGORY_ICON[categoryOf(type)];
}

/** "3 minutes ago" in the dashboard language. */
export function relativeTime(locale: string, at: number, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3_600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3_600), 'hour');
  if (abs < 30 * 86_400) return format.format(Math.round(seconds / 86_400), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
}

export function absoluteTime(locale: string, at: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(at);
}
