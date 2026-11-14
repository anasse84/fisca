import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { BlindCountError } from '../closing/blind-count.ts';
import type { VarianceReveal as VarianceRevealData } from '../closing/blind-count.ts';
import type { ClosingPorts } from '../closing/closing-ports.ts';
import type { CountMap } from '../closing/denominations.ts';
import { buildZDocument } from '../closing/z-print.ts';
import type { ZTicketData } from '../closing/z-layout.ts';
import { ZClosureError } from '../closing/z-closure.ts';
import { PRINTER_PROFILE_58_CP858 } from '../printing/escpos.ts';
import type { PrinterProfile } from '../printing/escpos.ts';
import { PrintError } from '../printing/print-queue.ts';
import { shortFingerprint } from '../printing/receipt-layout.ts';
import { BlindCountScreen } from './BlindCountScreen.tsx';
import { VarianceReveal } from './VarianceReveal.tsx';
import { ZTicketPreview } from './ZTicketPreview.tsx';
import { resolvePosLabels, zLabelSetOf } from './labels.ts';
import './pos.css';

export interface ClosingFlowProps extends ClosingPorts {
  readonly locale: FiscaLocale;
  readonly profile?: PrinterProfile;
  /** Imprime le Ticket Z (file d'impression existante) ; absent : pas de bouton actif. */
  readonly printZ?: (data: ZTicketData) => Promise<void>;
  readonly onSealed?: () => void;
}

type CountError = 'invalid' | 'notActive' | 'generic' | null;

/**
 * Fin de poste : comptage aveugle → (superviseur : écart) → aperçu et scellement du Ticket Z → impression.
 * Le panneau d'écart n'est monté QUE si le port `supervisor` existe (acteur autorisé) ; sinon rien n'est lu ni rendu.
 */
export function ClosingFlow(props: ClosingFlowProps): ReactElement {
  const labels = useMemo(() => resolvePosLabels(props.locale), [props.locale]);
  const [countedCents, setCountedCents] = useState<number | null>(props.lockedCountedCents);
  const [countBusy, setCountBusy] = useState(false);
  const [countError, setCountError] = useState<CountError>(null);
  const [reveal, setReveal] = useState<VarianceRevealData | null>(null);
  const [zData, setZData] = useState<ZTicketData | null>(props.sealedClosure);
  const [sealed, setSealed] = useState(props.sealedClosure !== null);
  const [sealBusy, setSealBusy] = useState(false);
  const [sealError, setSealError] = useState<'notReady' | 'generic' | null>(null);
  const [printed, setPrinted] = useState(false);
  const [printError, setPrintError] = useState<PrintError | null>(null);
  const portsRef = useRef(props);
  portsRef.current = props;
  const locked = countedCents !== null;
  const hasSupervisor = props.supervisor !== undefined;

  useEffect(() => {
    if (!locked || !hasSupervisor) return;
    let active = true;
    void portsRef.current.supervisor?.revealVariance().then((value) => {
      if (active) setReveal(value);
    }, () => undefined);
    return () => {
      active = false;
    };
  }, [locked, hasSupervisor]);

  useEffect(() => {
    if (!locked || sealed) return;
    let active = true;
    void portsRef.current.previewZ().then((value) => {
      if (active) setZData(value);
    }, () => {
      if (active) setSealError('generic');
    });
    return () => {
      active = false;
    };
  }, [locked, sealed]);

  const onLock = (counts: CountMap): void => {
    setCountBusy(true);
    setCountError(null);
    void props.lockCount(counts).then(
      (result) => {
        setCountedCents(result.countedCents);
        setCountBusy(false);
      },
      (error: unknown) => {
        setCountError(error instanceof BlindCountError ? (error.code === 'COUNT_INVALID' ? 'invalid' : error.code === 'SESSION_NOT_ACTIVE' ? 'notActive' : 'generic') : 'generic');
        setCountBusy(false);
      },
    );
  };

  const onSeal = (): void => {
    setSealBusy(true);
    setSealError(null);
    void props.sealZ().then(
      (data) => {
        setZData(data);
        setSealed(true);
        setSealBusy(false);
        props.onSealed?.();
      },
      (error: unknown) => {
        setSealError(error instanceof ZClosureError && error.code === 'COUNT_NOT_LOCKED' ? 'notReady' : 'generic');
        setSealBusy(false);
      },
    );
  };

  const onPrint = (): void => {
    if (zData === null || props.printZ === undefined) return;
    setPrintError(null);
    setPrinted(false);
    void props.printZ(zData).then(
      () => setPrinted(true),
      (error: unknown) => setPrintError(error instanceof PrintError ? error : new PrintError('TRANSPORT_FAILED', String(error))),
    );
  };

  const profile = props.profile ?? PRINTER_PROFILE_58_CP858;
  const document = useMemo(() => (zData === null ? [] : buildZDocument(zData, profile, zLabelSetOf('fr'), zLabelSetOf('ar'))), [zData, profile]);
  const columns = profile.paperWidthMm === 58 ? 32 : 48;

  return (
    <div className="pos-closing pos-main__full" dir={directionOf(props.locale)} data-testid="closing-flow">
      <BlindCountScreen
        labels={labels.count}
        denominations={props.denominations}
        lockedCountedCents={countedCents}
        busy={countBusy}
        errorText={countError === null ? null : labels.count.error[countError]}
        onLock={onLock}
      />
      {locked && reveal !== null ? <VarianceReveal labels={labels.variance} reveal={reveal} /> : null}
      {locked && zData !== null ? (
        <ZTicketPreview
          labels={{
            preview: labels.z.preview,
            seal: labels.z.seal,
            sealing: labels.z.sealing,
            sealed: labels.z.sealed,
            print: labels.z.print,
            printed: labels.z.printed,
            noSale: labels.z.noSale,
            errorText: sealError === null ? null : labels.z.error[sealError],
            printErrorText: printError === null ? null : labels.print.error[printError.code],
            retry: labels.sync.retry,
            qrAlt: labels.b2b.qrAlt,
            hash: labels.z.hash,
          }}
          document={document}
          columns={columns}
          isSealed={sealed}
          fingerprint={sealed && zData.zSha256 !== null ? shortFingerprint(zData.zSha256) : null}
          busy={sealBusy}
          canPrint={props.printZ !== undefined}
          printedNotice={printed}
          onSeal={onSeal}
          onPrint={onPrint}
        />
      ) : null}
      {locked && zData === null ? <p className="pos-status" role="status">{labels.z.loading}</p> : null}
    </div>
  );
}
