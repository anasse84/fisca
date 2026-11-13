import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import type { FiscaLocale } from '@fisca/i18n';
import type { ApiProblem, AuthApi, FieldIssue, SecondFactorMethod } from './api-client.ts';
import { authFlowReducer, initialAuthFlow, lockRemainingSecOf } from './auth-flow-machine.ts';
import type { AuthFlowState, NavigableStep } from './auth-flow-machine.ts';
import { translateStrict } from '../command-review.tsx';
import { AuthShell, Button, EyeIcon, TextField } from './auth-ui.tsx';
import { fillTemplate, resolveAuthLabels } from './labels.ts';
import type { AuthLabels } from './labels.ts';
import { authenticateWithPasskey } from './passkey.ts';
import type { CredentialsLike } from './passkey.ts';
import { assessPasswordStrength } from './password-strength.ts';

export interface AuthenticatedSession {
  readonly accessToken: string;
  readonly expiresInSec: number;
  /** Sortie PRF du passkey (clé E2EE) : en mémoire seulement, jamais envoyée au serveur ni stockée. */
  readonly prfOutput: Uint8Array | null;
}

export interface AuthFlowProps {
  readonly locale: FiscaLocale;
  readonly api: AuthApi;
  readonly onAuthenticated: (session: AuthenticatedSession) => void;
  readonly initialStep?: NavigableStep;
  /** Jeton du lien de réinitialisation (extrait du lien par l'hôte) ; absent : le champ de saisie est proposé. */
  readonly resetToken?: string;
  readonly now?: () => number;
  readonly navigate?: (url: string) => void;
  /** Conteneur de credentials WebAuthn ; `null` masque le bouton passkey. Défaut : navigator.credentials si WebAuthn existe. */
  readonly passkeyCredentials?: CredentialsLike | null;
}

export function detectPasskeyCredentials(): CredentialsLike | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || !('PublicKeyCredential' in window)) {
    return null;
  }
  return navigator.credentials;
}

const defaultNavigate = (url: string): void => window.location.assign(url);

const STEP_TITLE = {
  login: 'title.login',
  signup: 'title.signup',
  'verify-email': 'title.verifyEmail',
  mfa: 'title.mfa',
  forgot: 'title.forgot',
  'forgot-sent': 'title.forgotSent',
  reset: 'title.reset',
  'reset-done': 'title.resetDone',
  authenticated: 'title.login',
} as const;

function fieldMessage(errors: Readonly<Record<string, readonly FieldIssue[]>>, field: string, labels: AuthLabels): string | null {
  if (errors[field] === undefined) {
    return null;
  }
  return field === 'email' ? labels['errors.field.email'] : field === 'password' || field === 'newPassword' ? labels['errors.field.password'] : labels['errors.field.generic'];
}

interface ScreenContext {
  readonly state: AuthFlowState;
  readonly labels: AuthLabels;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly run: (task: () => Promise<void>) => Promise<void>;
  readonly api: AuthApi;
  readonly dispatch: (event: Parameters<typeof authFlowReducer>[1]) => void;
  readonly now: () => number;
  readonly onSession: (session: AuthenticatedSession) => void;
  readonly backLabel: string;
}

function PasswordField(props: {
  readonly ctx: ScreenContext;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: 'current-password' | 'new-password';
  readonly name: string;
  readonly fieldKey: string;
  readonly hint?: string;
}): ReactElement {
  const [visible, setVisible] = useState(false);
  const { labels } = props.ctx;
  return (
    <TextField
      name={props.name}
      label={props.label}
      value={props.value}
      onChange={props.onChange}
      type={visible ? 'text' : 'password'}
      autoComplete={props.autoComplete}
      dir="ltr"
      required
      error={fieldMessage(props.ctx.state.fieldErrors, props.fieldKey, labels)}
      hint={props.hint ?? null}
      trailing={
        <Button ariaLabel={visible ? labels['action.hidePassword'] : labels['action.showPassword']} ariaPressed={visible} onClick={() => setVisible((v) => !v)}>
          <EyeIcon crossed={visible} />
        </Button>
      }
    />
  );
}

function StrengthMeter({ password, labels }: { readonly password: string; readonly labels: AuthLabels }): ReactElement {
  const strength = assessPasswordStrength(password);
  const levelText = strength.level === 'empty' ? '' : labels[`strength.${strength.level}`];
  return (
    <div>
      {strength.level === 'empty' ? null : (
        <div className="fisca-auth__meter" data-level={strength.level} role="meter" aria-label={labels['strength.label']} aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.score} aria-valuetext={levelText}>
          {[1, 2, 3, 4].map((index) => (
            <span key={index} className="fisca-auth__meter-seg" data-on={index <= strength.score ? 'true' : 'false'} />
          ))}
        </div>
      )}
      <p className="fisca-auth__strength-text" aria-live="polite">
        {strength.level === 'empty' ? '' : `${labels['strength.label']} : ${levelText}`}
      </p>
    </div>
  );
}

function SocialButtons({ ctx, google, passkey }: { readonly ctx: ScreenContext; readonly google: () => void; readonly passkey: (() => void) | null }): ReactElement {
  return (
    <>
      <div className="fisca-auth__divider" aria-hidden="true">
        <span>{ctx.labels['divider.or']}</span>
      </div>
      <div className="fisca-auth__actions">
        <Button onClick={google} disabled={ctx.busy}>
          {ctx.labels['action.google']}
        </Button>
        {passkey === null ? null : (
          <Button onClick={passkey} disabled={ctx.busy}>
            {ctx.labels['action.passkey']}
          </Button>
        )}
      </div>
    </>
  );
}

function LoginScreen({ ctx, onGoogle, onPasskey }: { readonly ctx: ScreenContext; readonly onGoogle: () => void; readonly onPasskey: (() => void) | null }): ReactElement {
  const { labels, state } = ctx;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ctx.run(async () => {
      const result = await ctx.api.login({ email, password });
      if (!result.ok) {
        return ctx.dispatch({ type: 'FAILED', problem: result.problem, nowMs: ctx.now() });
      }
      if (result.data.kind === 'MFA_REQUIRED') {
        return ctx.dispatch({
          type: 'MFA_REQUIRED',
          challenge: { token: result.data.mfaChallengeToken, expiresAtEpochSec: result.data.expiresAtEpochSec, methods: result.data.methods },
        });
      }
      ctx.dispatch({ type: 'AUTHENTICATED' });
      ctx.onSession({ accessToken: result.data.accessToken, expiresInSec: result.data.expiresInSec, prfOutput: null });
    });
  };
  return (
    <>
      <form className="fisca-auth__form" onSubmit={submit} noValidate>
        <TextField name="email" label={labels['field.email']} value={email} onChange={setEmail} type="email" autoComplete="username" inputMode="email" dir="ltr" required error={fieldMessage(state.fieldErrors, 'email', labels)} />
        <PasswordField ctx={ctx} name="password" fieldKey="password" label={labels['field.password']} value={password} onChange={setPassword} autoComplete="current-password" />
        <Button variant="link" onClick={() => ctx.dispatch({ type: 'NAVIGATE', to: 'forgot' })}>
          {labels['action.forgot']}
        </Button>
        <Button type="submit" variant="primary" disabled={ctx.busy || ctx.locked}>
          {labels['action.login']}
        </Button>
      </form>
      <SocialButtons ctx={ctx} google={onGoogle} passkey={onPasskey} />
      <Button variant="link" onClick={() => ctx.dispatch({ type: 'NAVIGATE', to: 'signup' })}>
        {labels['action.toSignup']}
      </Button>
    </>
  );
}

function SignupScreen({ ctx, onGoogle }: { readonly ctx: ScreenContext; readonly onGoogle: () => void }): ReactElement {
  const { labels, state } = ctx;
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ctx.run(async () => {
      const result = await ctx.api.register({ email, password, fullName });
      return result.ok ? ctx.dispatch({ type: 'REGISTERED', email }) : ctx.dispatch({ type: 'FAILED', problem: result.problem, nowMs: ctx.now() });
    });
  };
  return (
    <>
      <form className="fisca-auth__form" onSubmit={submit} noValidate>
        <TextField name="full_name" label={labels['field.fullName']} value={fullName} onChange={setFullName} autoComplete="name" dir="auto" required error={fieldMessage(state.fieldErrors, 'full_name', labels)} />
        <TextField name="email" label={labels['field.email']} value={email} onChange={setEmail} type="email" autoComplete="email" inputMode="email" dir="ltr" required error={fieldMessage(state.fieldErrors, 'email', labels)} />
        <PasswordField ctx={ctx} name="password" fieldKey="password" label={labels['field.password']} value={password} onChange={setPassword} autoComplete="new-password" hint={labels['strength.hint']} />
        <StrengthMeter password={password} labels={labels} />
        <Button type="submit" variant="primary" disabled={ctx.busy || ctx.locked}>
          {labels['action.signup']}
        </Button>
      </form>
      <SocialButtons ctx={ctx} google={onGoogle} passkey={null} />
      <Button variant="link" onClick={() => ctx.dispatch({ type: 'BACK' })}>
        {labels['action.toLogin']}
      </Button>
    </>
  );
}

function VerifyEmailScreen({ ctx }: { readonly ctx: ScreenContext }): ReactElement {
  const { labels, state } = ctx;
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ctx.run(async () => {
      const result = await ctx.api.verifyEmail({ token: code.trim() });
      return result.ok ? ctx.dispatch({ type: 'EMAIL_VERIFIED' }) : ctx.dispatch({ type: 'FAILED', problem: result.problem, nowMs: ctx.now() });
    });
  };
  return (
    <form className="fisca-auth__form" onSubmit={submit} noValidate>
      <p className="fisca-auth__subtitle">{fillTemplate(labels['body.verifyEmail'], { email: state.pendingEmail ?? '' })}</p>
      <TextField name="code" label={labels['field.verifyCode']} value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" dir="ltr" code required error={fieldMessage(state.fieldErrors, 'token', labels)} />
      <Button type="submit" variant="primary" disabled={ctx.busy || ctx.locked}>
        {labels['action.verifyEmail']}
      </Button>
      <Button variant="link" onClick={() => ctx.dispatch({ type: 'BACK' })}>
        {labels['action.backToLogin']}
      </Button>
    </form>
  );
}

const MFA_NUMERIC: ReadonlySet<SecondFactorMethod> = new Set<SecondFactorMethod>(['TOTP', 'INFOBIP_OTP']);

function MfaScreen({ ctx, onBack }: { readonly ctx: ScreenContext; readonly onBack: () => void }): ReactElement {
  const { labels, state } = ctx;
  const methods = state.challenge?.methods ?? [];
  const [method, setMethod] = useState<SecondFactorMethod>(methods[0] ?? 'TOTP');
  const [code, setCode] = useState('');
  const numeric = MFA_NUMERIC.has(method);
  const maxLength = method === 'TOTP' ? 6 : numeric ? 8 : 32;
  const sanitize = (raw: string) => (numeric ? raw.replace(/\D/gu, '').slice(0, maxLength) : raw.trim().slice(0, maxLength));
  const hintKey = `hint.${method}` as const;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const token = state.challenge?.token;
    if (token === undefined) {
      return;
    }
    void ctx.run(async () => {
      const result = await ctx.api.verifyMfa({ mfaChallengeToken: token, method, code });
      if (!result.ok) {
        return ctx.dispatch({ type: 'FAILED', problem: result.problem, nowMs: ctx.now() });
      }
      ctx.dispatch({ type: 'AUTHENTICATED' });
      ctx.onSession({ accessToken: result.data.accessToken, expiresInSec: result.data.expiresInSec, prfOutput: null });
    });
  };
  const groupLabelId = 'fisca-auth-method-label';
  return (
    <form className="fisca-auth__form" onSubmit={submit} noValidate>
      <div role="radiogroup" aria-labelledby={groupLabelId} className="fisca-auth__radiogroup">
        <span id={groupLabelId} className="fisca-auth__label">
          {labels['method.label']}
        </span>
        {methods.map((item) => (
          <label key={item} className="fisca-auth__radio">
            <input
              type="radio"
              name="mfa-method"
              value={item}
              checked={method === item}
              onChange={() => {
                setMethod(item);
                setCode('');
              }}
            />
            <span>{labels[`method.${item}`]}</span>
          </label>
        ))}
      </div>
      <TextField
        name="code"
        label={labels['field.code']}
        value={code}
        onChange={(raw) => setCode(sanitize(raw))}
        autoComplete={numeric ? 'one-time-code' : 'off'}
        inputMode={numeric ? 'numeric' : 'text'}
        dir="ltr"
        maxLength={maxLength}
        code
        required
        hint={labels[hintKey]}
        error={fieldMessage(state.fieldErrors, 'code', labels)}
      />
      <Button type="submit" variant="primary" disabled={ctx.busy || ctx.locked}>
        {labels['action.submitCode']}
      </Button>
      <Button variant="link" onClick={onBack}>
        {ctx.backLabel}
      </Button>
    </form>
  );
}

function ForgotScreen({ ctx }: { readonly ctx: ScreenContext }): ReactElement {
  const { labels, state } = ctx;
  const [email, setEmail] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ctx.run(async () => {
      const result = await ctx.api.forgotPassword({ email });
      return result.ok ? ctx.dispatch({ type: 'FORGOT_SENT' }) : ctx.dispatch({ type: 'FAILED', problem: result.problem, nowMs: ctx.now() });
    });
  };
  return (
    <form className="fisca-auth__form" onSubmit={submit} noValidate>
      <TextField name="email" label={labels['field.email']} value={email} onChange={setEmail} type="email" autoComplete="email" inputMode="email" dir="ltr" required error={fieldMessage(state.fieldErrors, 'email', labels)} />
      <Button type="submit" variant="primary" disabled={ctx.busy || ctx.locked}>
        {labels['action.sendLink']}
      </Button>
      <Button variant="link" onClick={() => ctx.dispatch({ type: 'BACK' })}>
        {labels['action.backToLogin']}
      </Button>
    </form>
  );
}

function ResetScreen({ ctx, resetToken }: { readonly ctx: ScreenContext; readonly resetToken: string | undefined }): ReactElement {
  const { labels, state } = ctx;
  const [typedToken, setTypedToken] = useState('');
  const [password, setPassword] = useState('');
  const token = resetToken ?? typedToken;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ctx.run(async () => {
      const result = await ctx.api.resetPassword({ token, newPassword: password });
      return result.ok ? ctx.dispatch({ type: 'RESET_DONE' }) : ctx.dispatch({ type: 'FAILED', problem: result.problem, nowMs: ctx.now() });
    });
  };
  return (
    <form className="fisca-auth__form" onSubmit={submit} noValidate>
      {resetToken === undefined ? (
        <TextField name="token" label={labels['field.resetToken']} value={typedToken} onChange={setTypedToken} dir="ltr" code required error={fieldMessage(state.fieldErrors, 'token', labels)} />
      ) : null}
      <PasswordField ctx={ctx} name="newPassword" fieldKey="newPassword" label={labels['field.newPassword']} value={password} onChange={setPassword} autoComplete="new-password" hint={labels['strength.hint']} />
      <StrengthMeter password={password} labels={labels} />
      <Button type="submit" variant="primary" disabled={ctx.busy || ctx.locked}>
        {labels['action.reset']}
      </Button>
    </form>
  );
}

function MessageScreen({ ctx, body }: { readonly ctx: ScreenContext; readonly body: string }): ReactElement {
  return (
    <>
      <p className="fisca-auth__subtitle">{body}</p>
      <Button variant="primary" onClick={() => ctx.dispatch({ type: 'NAVIGATE', to: 'login' })}>
        {ctx.labels['action.backToLogin']}
      </Button>
    </>
  );
}

export function AuthFlow({ locale, api, onAuthenticated, initialStep = 'login', resetToken, now = Date.now, navigate = defaultNavigate, passkeyCredentials }: AuthFlowProps): ReactElement {
  const labels = useMemo(() => resolveAuthLabels(locale), [locale]);
  const [state, dispatch] = useReducer(authFlowReducer, initialStep, initialAuthFlow);
  const [, forceRender] = useState(0);
  const [errorSeq, setErrorSeq] = useState(0);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const credentials = useMemo(() => (passkeyCredentials === undefined ? detectPasskeyCredentials() : passkeyCredentials), [passkeyCredentials]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const nowMs = now();
  const lockSec = lockRemainingSecOf(state, nowMs);
  const locked = lockSec > 0;

  useEffect(() => {
    if (!locked && state.step !== 'mfa') {
      return undefined;
    }
    const timer = setInterval(() => {
      dispatch({ type: 'TICK', nowMs: now() });
      forceRender((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [locked, state.step, now]);

  const send = useCallback((event: Parameters<typeof authFlowReducer>[1]) => {
    if (event.type === 'FAILED' || (event.type === 'SUBMIT' && lockRemainingSecOf(stateRef.current, event.nowMs) > 0)) {
      setErrorSeq((n) => n + 1);
    }
    dispatch(event);
  }, []);

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (lockRemainingSecOf(stateRef.current, now()) > 0) {
        send({ type: 'SUBMIT', nowMs: now() });
        return;
      }
      send({ type: 'SUBMIT', nowMs: now() });
      await task();
    },
    [now, send],
  );

  const handleGoogle = () => {
    void run(async () => {
      const url = await api.googleStartUrl();
      navigate(url);
    });
  };

  const handlePasskey = () => {
    void run(async () => {
      setPasskeyBusy(true);
      const outcome = await authenticateWithPasskey({ api, credentials });
      setPasskeyBusy(false);
      if (outcome.ok) {
        send({ type: 'AUTHENTICATED' });
        onAuthenticated({ accessToken: outcome.session.accessToken, expiresInSec: outcome.session.expiresInSec, prfOutput: outcome.prfOutput });
        return;
      }
      const problem: ApiProblem =
        outcome.reason === 'API'
          ? outcome.problem
          : { status: 0, errorCode: outcome.reason === 'CANCELLED' ? 'PASSKEY_CANCELLED' : 'PASSKEY_AUTHENTICATION_FAILED', retryAfterSec: null, fieldErrors: {} };
      send({ type: 'FAILED', problem, nowMs: now() });
    });
  };

  const ctx: ScreenContext = {
    state,
    labels,
    locked,
    busy: state.busy || passkeyBusy,
    run,
    api,
    dispatch: send,
    now,
    onSession: onAuthenticated,
    backLabel: translateStrict(locale, 'common', 'actions.back'),
  };

  const statusText = locked ? fillTemplate(labels['status.locked'], { seconds: lockSec }) : passkeyBusy ? labels['status.passkeyWaiting'] : state.busy ? labels['status.busy'] : null;
  const errorText = state.errorKey === null ? null : labels[state.errorKey];
  const subtitle = state.step === 'mfa' ? labels['subtitle.mfa'] : state.step === 'forgot' ? labels['subtitle.forgot'] : undefined;

  let body: ReactElement;
  switch (state.step) {
    case 'login':
      body = <LoginScreen ctx={ctx} onGoogle={handleGoogle} onPasskey={credentials === null ? null : handlePasskey} />;
      break;
    case 'signup':
      body = <SignupScreen ctx={ctx} onGoogle={handleGoogle} />;
      break;
    case 'verify-email':
      body = <VerifyEmailScreen ctx={ctx} />;
      break;
    case 'mfa':
      body = <MfaScreen ctx={ctx} onBack={() => send({ type: 'BACK' })} />;
      break;
    case 'forgot':
      body = <ForgotScreen ctx={ctx} />;
      break;
    case 'forgot-sent':
      body = <MessageScreen ctx={ctx} body={labels['body.forgotSent']} />;
      break;
    case 'reset':
      body = <ResetScreen ctx={ctx} resetToken={resetToken} />;
      break;
    case 'reset-done':
      body = <MessageScreen ctx={ctx} body={labels['body.resetDone']} />;
      break;
    case 'authenticated':
      body = <></>;
      break;
  }

  return (
    <AuthShell locale={locale} title={labels[STEP_TITLE[state.step]]} subtitle={subtitle} stepKey={state.step} errorText={errorText} errorSeq={errorSeq} statusText={statusText}>
      {body}
    </AuthShell>
  );
}
