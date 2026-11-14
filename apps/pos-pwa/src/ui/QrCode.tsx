import qrcode from 'qrcode-generator';
import type { ReactElement } from 'react';

export interface QrCodeProps {
  readonly data: string;
  /** Libellé accessible, fourni par l'appelant (dictionnaire). */
  readonly label: string;
}

const QUIET_ZONE = 4;

/** QR code en SVG (correction M) ; modules noirs sur fond blanc : ne s'inverse pas en thème sombre pour rester lisible par un scanner. */
export function QrCode({ data, label }: QrCodeProps): ReactElement {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${String(col + QUIET_ZONE)},${String(row + QUIET_ZONE)}h1v1h-1z`;
    }
  }
  return (
    <svg
      className="pos-qr__svg"
      data-testid="qr-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
