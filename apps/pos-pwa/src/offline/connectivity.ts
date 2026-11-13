/** Moniteur de connectivité : cible injectable (window en navigateur, faux en test). */

export interface ConnectivityTarget {
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}

/** Notifie l'état initial puis chaque changement ; retourne la fonction de désabonnement. */
export function createConnectivityMonitor(
  target: ConnectivityTarget,
  isOnline: () => boolean,
  onChange: (online: boolean) => void,
): () => void {
  const notify = (): void => onChange(isOnline());
  target.addEventListener('online', notify);
  target.addEventListener('offline', notify);
  notify();
  return () => {
    target.removeEventListener('online', notify);
    target.removeEventListener('offline', notify);
  };
}
