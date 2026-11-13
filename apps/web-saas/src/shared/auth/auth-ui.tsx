import { useEffect, useId, useRef } from 'react';
import type { ChangeEvent, ReactElement, ReactNode, Ref } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import './auth.css';

export interface AuthShellProps {
  readonly locale: FiscaLocale;
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Identifie l'étape : un changement déplace le focus sur le titre (WCAG 2.4.3). */
  readonly stepKey: string;
  readonly errorText: string | null;
  /** Change à chaque nouvelle erreur, même identique : le focus revient sur la région d'erreur. */
  readonly errorSeq: number;
  readonly statusText: string | null;
  readonly children: ReactNode;
}

/** Coque commune : sens d'écriture, titre unique h1, région d'erreur role=alert (toujours montée), région d'état. */
export function AuthShell({ locale, title, subtitle, stepKey, errorText, errorSeq, statusText, children }: AuthShellProps): ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (mounted.current) {
      headingRef.current?.focus();
    }
  }, [stepKey]);

  useEffect(() => {
    if (mounted.current && errorText !== null) {
      alertRef.current?.focus();
    }
  }, [errorText, errorSeq]);

  useEffect(() => {
    mounted.current = true;
  }, []);

  return (
    <div className="fisca-auth" dir={directionOf(locale)} lang={locale}>
      <section className="fisca-auth__card" aria-labelledby={titleId}>
        <h1 id={titleId} ref={headingRef} tabIndex={-1} className="fisca-auth__title">
          {title}
        </h1>
        {subtitle === undefined ? null : <p className="fisca-auth__subtitle">{subtitle}</p>}
        <p ref={alertRef} role="alert" tabIndex={-1} className="fisca-auth__alert">
          {errorText}
        </p>
        <p role="status" className="fisca-auth__status">
          {statusText}
        </p>
        {children}
      </section>
    </div>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'email' | 'password';
  readonly autoComplete?: string;
  readonly inputMode?: 'text' | 'numeric' | 'email';
  readonly dir?: 'ltr' | 'rtl' | 'auto';
  readonly maxLength?: number;
  readonly error?: string | null;
  readonly hint?: string | null;
  readonly code?: boolean;
  readonly required?: boolean;
  readonly name: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly trailing?: ReactNode;
}

export function TextField(props: TextFieldProps): ReactElement {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = props.error !== undefined && props.error !== null;
  const describedBy = [hasError ? errorId : null, props.hint ? hintId : null].filter((x): x is string => x !== null).join(' ');
  return (
    <div className="fisca-auth__field">
      <label htmlFor={id} className="fisca-auth__label">
        {props.label}
      </label>
      <div className="fisca-auth__control">
        <input
          id={id}
          name={props.name}
          ref={props.inputRef}
          className={`fisca-auth__input${props.code === true ? ' fisca-auth__code fisca-tabular-num' : ''}`}
          type={props.type ?? 'text'}
          value={props.value}
          autoComplete={props.autoComplete ?? 'off'}
          inputMode={props.inputMode}
          dir={props.dir}
          maxLength={props.maxLength}
          aria-required={props.required === true ? 'true' : undefined}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value)}
        />
        {props.trailing}
      </div>
      {props.hint ? (
        <p id={hintId} className="fisca-auth__hint">
          {props.hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} className="fisca-auth__field-error">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly type?: 'button' | 'submit';
  readonly variant?: 'primary' | 'default' | 'link';
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly ariaPressed?: boolean;
}

export function Button({ children, onClick, type = 'button', variant = 'default', disabled = false, ariaLabel, ariaPressed }: ButtonProps): ReactElement {
  const className = variant === 'link' ? 'fisca-auth__link' : `fisca-auth__button${variant === 'primary' ? ' fisca-auth__button--primary' : ''}`;
  return (
    <button type={type} className={className} onClick={onClick} disabled={disabled} aria-label={ariaLabel} aria-pressed={ariaPressed}>
      {children}
    </button>
  );
}

/** Œil : forme universelle, jamais retournée en RTL. */
export function EyeIcon({ crossed }: { readonly crossed: boolean }): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}
