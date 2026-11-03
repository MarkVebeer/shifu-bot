import { logoSvg } from '@shifubot/shared';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-bg shadow-glow hover:shadow-glow-strong hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none',
  secondary:
    'border border-line bg-raised/70 text-ink hover:border-primary/60 hover:bg-raised active:scale-[0.98] disabled:opacity-50',
  ghost: 'text-muted hover:bg-raised/60 hover:text-ink disabled:opacity-50',
  danger: 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg' | 'icon';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition duration-200 disabled:cursor-not-allowed',
        size === 'md' && 'min-h-11 px-5 text-sm',
        size === 'lg' && 'min-h-12 px-6 text-base',
        size === 'icon' && 'size-11 shrink-0',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

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
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition duration-200',
        buttonStyles[variant],
        className,
      )}
    >
      {icon}
      {children}
    </a>
  );
}

export function Card({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cx('glass p-4 sm:p-6', className)}>{children}</Tag>;
}

export function CardHeader({ title, description, icon }: { title: ReactNode; description?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start gap-3">
      {icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-token bg-brand-soft text-lg ring-1 ring-primary/25" aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
    </header>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: logoSvg(size) }} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton', className)} />;
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
      <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-medium text-ink">
        {label}
        {optional && <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-normal text-muted">{optionalLabel}</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : warning ? (
        <p id={`${htmlFor}-help`} className="text-sm text-warning">
          {warning}
        </p>
      ) : (
        help && (
          <p id={`${htmlFor}-help`} className="text-sm text-muted">
            {help}
          </p>
        )
      )}
    </div>
  );
}

const inputClass =
  'w-full rounded-token border border-line bg-bg/60 px-3.5 text-base text-ink placeholder:text-muted/60 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-danger sm:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputClass, 'min-h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(inputClass, 'min-h-28 resize-y py-3 leading-relaxed', className)} {...rest} />;
});

export function Select({
  id,
  value,
  onChange,
  children,
  ...rest
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  'aria-describedby'?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cx(inputClass, 'min-h-11 appearance-none pr-10')}
        {...rest}
      >
        {children}
      </select>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-muted">
        ▾
      </span>
    </div>
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
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition duration-200',
          checked ? 'border-primary/60 bg-brand shadow-glow' : 'border-line bg-raised',
        )}
      >
        <span
          className={cx(
            'inline-block size-6 rounded-full shadow transition-transform duration-200',
            checked ? 'translate-x-7 bg-bg' : 'translate-x-1 bg-muted',
          )}
        />
      </button>
    </div>
  );
}

const alertStyles = {
  info: { box: 'border-primary/30 bg-primary/10 text-ink', icon: <Info className="size-5 text-primary" aria-hidden /> },
  success: { box: 'border-success/30 bg-success/10 text-ink', icon: <CheckCircle2 className="size-5 text-success" aria-hidden /> },
  warning: { box: 'border-warning/35 bg-warning/10 text-ink', icon: <AlertTriangle className="size-5 text-warning" aria-hidden /> },
  danger: { box: 'border-danger/35 bg-danger/10 text-ink', icon: <XCircle className="size-5 text-danger" aria-hidden /> },
} as const;

export function Alert({ tone = 'info', children, action }: { tone?: keyof typeof alertStyles; children: ReactNode; action?: ReactNode }) {
  const style = alertStyles[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cx('flex animate-fade-in items-start gap-3 rounded-panel border px-4 py-3 text-sm', style.box)}
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {action}
    </div>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'muted' | 'success' | 'primary' | 'warning'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        tone === 'muted' && 'bg-raised text-muted',
        tone === 'success' && 'bg-success/15 text-success',
        tone === 'primary' && 'bg-primary/15 text-primary',
        tone === 'warning' && 'bg-warning/15 text-warning',
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (src) return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full ring-1 ring-line" style={{ width: size, height: size }} />;
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-primary ring-1 ring-line"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials}
    </span>
  );
}
