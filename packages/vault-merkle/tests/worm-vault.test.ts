import { createInMemoryWormVault } from './support/in-memory-worm-vault.ts';
import { runWormVaultDriverContractTests } from './support/worm-vault-contract.ts';

runWormVaultDriverContractTests(() => {
  const nowMs = (): number => Date.UTC(2026, 0, 15, 12, 0, 0);
  const vault = createInMemoryWormVault(nowMs);
  return { vault, tryDelete: (key) => vault.tryDeleteObject(key), nowMs };
});
