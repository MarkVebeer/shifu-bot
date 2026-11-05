/**
 * ShifuBot's UI primitives, built on the shadcn/ui components in components/ui.
 * Pages use these wrappers, so they keep one small API (variant names, touch
 * sized controls, labels and help text) while the look comes from shadcn/ui.
 */
import { logoSvg } from '@shifubot/shared';
import { CheckCircle, CircleNotch, Info, Warning, XCircle } from '@phosphor-icons/react';
import { Children, Fragment, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert';
import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Card as UiCard } from '@/components/ui/card';
import { Input as UiInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select as UiSelect, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton as UiSkeleton } from '@/components/ui/skeleton';
import { Switch as UiSwitch } from '@/components/ui/switch';
import { Textarea as UiTextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** Join class names; later Tailwind classes win. Same as shadcn's cn(). */
export const cx = cn;

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const shadcnVariant = {
  primary: 'default',
  secondary: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
} as const satisfies Record<ButtonVariant, ComponentProps<typeof UiButton>['variant']>;

/** At least 44 px tall so every control is easy to hit on touch screens. */
const buttonSizes = {
  md: 'h-auto min-h-11 px-5',
  lg: 'h-auto min-h-12 px-6 text-base',
  icon: 'size-11',
} as const;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <UiButton
      type={type}
      variant={shadcnVariant[variant]}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonSizes[size], variant === 'ghost' && 'text-muted-foreground hover:text-foreground', className)}
      {...rest}
    >
      {loading ? <CircleNotch className="animate-spin" aria-hidden /> : icon}
      {children}
    </UiButton>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  icon,
  className,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: ReactNode;
  className?: string;
  external?: boolean;
}) {
  return (
    <UiButton asChild variant={shadcnVariant[variant]} className={cn(buttonSizes.md, className)}>
      <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
        {icon}
        {children}
      </a>
    </UiButton>
  );
}

/** shadcn/ui Card with ShifuBot's padding. `as` sets the landmark role ("section" by default). */
export function Card({ children, className }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return (
    <UiCard className={cn('block gap-0 p-4 sm:p-6', className)}>
      {children}
    </UiCard>
  );
}

/** Card title row: a small gray icon, the title, and an optional line of help below it. */
export function CardHeader({ title, description, icon, action }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <header data-slot="card-header" className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold leading-6 tracking-tight">
          {icon && (
            <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
              {icon}
            </span>
          )}
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/**
 * The top of every dashboard page: title, one line of description and optional
 * actions on the right, closed by a hairline so the content starts clearly below.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  badge,
  actions,
  leading,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Small gray line above the title, e.g. "Feature" or "Server overview". */
  eyebrow?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  /** Shown before the title block, e.g. the server avatar. */
  leading?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-subtle">{eyebrow}</p>}
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="min-w-0 truncate">{title}</span>
            {badge}
          </h1>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: logoSvg(size, { mono: true }) }} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <UiSkeleton aria-hidden className={className} />;
}

export function Field({
  label,
  help,
  error,
  warning,
  htmlFor,
  optional,
  optionalLabel,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  warning?: ReactNode;
  htmlFor: string;
  optional?: boolean;
  optionalLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} className="text-[13px]">
        {label}
        {optional && (
          <UiBadge variant="secondary" className="font-normal text-muted-foreground">
            {optionalLabel}
          </UiBadge>
        )}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : warning ? (
        <p id={`${htmlFor}-help`} className="text-sm text-warning">
          {warning}
        </p>
      ) : (
        help && (
          <p id={`${htmlFor}-help`} className="text-sm text-muted-foreground">
            {help}
          </p>
        )
      )}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <UiInput className={cn('h-11 text-base sm:text-sm', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <UiTextarea className={cn('min-h-28 resize-y py-3 text-base leading-relaxed sm:text-sm', className)} {...rest} />;
}

/** Radix Select does not allow "" as an item value, so "" (none chosen) travels as this. */
const EMPTY = '__none__';

const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : ''))
    .join('');

interface OptionProps {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
}

/** Turn <option> / <optgroup> children into shadcn/ui SelectItem / SelectGroup. */
function toItems(children: ReactNode): { items: ReactElement[]; placeholder: string | null } {
  let placeholder: string | null = null;
  const walk = (node: ReactNode): ReactElement[] =>
    Children.toArray(node).flatMap((child): ReactElement[] => {
      if (!isValidElement(child)) return [];
      if (child.type === Fragment) return walk((child.props as { children?: ReactNode }).children);
      if (child.type === 'optgroup') {
        const props = child.props as { label?: string; children?: ReactNode };
        return [
          <SelectGroup key={child.key ?? props.label}>
            <SelectLabel>{props.label}</SelectLabel>
            {walk(props.children)}
          </SelectGroup>,
        ];
      }
      if (child.type === 'option') {
        const props = child.props as OptionProps;
        const value = String(props.value ?? '');
        const label = textOf(props.children);
        if (value === '') placeholder = label;
        return [
          <SelectItem key={child.key ?? value} value={value === '' ? EMPTY : value} disabled={props.disabled}>
            {label}
          </SelectItem>,
        ];
      }
      return [];
    });
  const items = walk(children);
  return { items, placeholder };
}

/**
 * shadcn/ui Select. Callers pass plain <option> and <optgroup> children like a
 * native select; an option with value "" is the "nothing chosen" choice.
 */
export function Select({
  id,
  value,
  onChange,
  children,
  disabled,
  'aria-describedby': describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  'aria-describedby'?: string;
  disabled?: boolean;
}) {
  const { items, placeholder } = toItems(children);
  return (
    <UiSelect value={value === '' ? (placeholder === null ? '' : EMPTY) : value} onValueChange={(next) => onChange(next === EMPTY ? '' : next)} disabled={disabled}>
      <SelectTrigger id={id} aria-describedby={describedBy} className="h-11 min-h-11 w-full text-base sm:text-sm">
        <SelectValue placeholder={placeholder ?? undefined} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {items}
      </SelectContent>
    </UiSelect>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  id: idProp,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  id?: string;
}) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-sm">
          {label}
        </Label>
        {description && (
          <p id={`${id}-desc`} className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <UiSwitch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={description ? `${id}-desc` : undefined} />
    </div>
  );
}

const alertTones = {
  info: { variant: 'default', className: '', icon: <Info aria-hidden /> },
  success: { variant: 'default', className: '', icon: <CheckCircle aria-hidden /> },
  warning: { variant: 'default', className: 'border-warning/40 [&>svg]:text-warning', icon: <Warning aria-hidden /> },
  danger: { variant: 'destructive', className: 'border-destructive/40', icon: <XCircle aria-hidden /> },
} as const;

export function Alert({ tone = 'info', children, action }: { tone?: keyof typeof alertTones; children: ReactNode; action?: ReactNode }) {
  const style = alertTones[tone];
  return (
    <UiAlert
      variant={style.variant}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('animate-fade-in', style.className)}
    >
      {style.icon}
      <AlertDescription className={cn('leading-relaxed text-foreground', action && 'flex flex-wrap items-center justify-between gap-3')}>
        <div className="min-w-0 flex-1">{children}</div>
        {action}
      </AlertDescription>
    </UiAlert>
  );
}

const badgeTones = {
  muted: { className: 'border-border bg-muted text-muted-foreground', dot: 'bg-subtle' },
  success: { className: 'border-success/25 bg-success/10 text-success', dot: 'bg-success' },
  primary: { className: 'border-brand/30 bg-brand/10 text-brand', dot: 'bg-brand' },
  warning: { className: 'border-warning/30 bg-warning/10 text-warning', dot: 'bg-warning' },
} as const;

/** Small status pill with a colored dot: "● Active", "● Off". */
export function Badge({ tone = 'muted', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  const style = badgeTones[tone];
  return (
    <UiBadge variant="outline" className={cn('gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', style.className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', style.dot)} />
      {children}
    </UiBadge>
  );
}

export function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <UiAvatar className="shrink-0 border" style={{ width: size, height: size }}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback aria-hidden className="font-semibold" style={{ fontSize: size / 2.8 }}>
        {initials}
      </AvatarFallback>
    </UiAvatar>
  );
}
