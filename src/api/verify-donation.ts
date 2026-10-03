// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { DonationChain } from '@/lib/donation-wallets';

export interface VerifiedDonation {
  chain: DonationChain;
  txHash: string;
  recipient: string;
  amountNative: number;
  asset: 'ETH' | 'BTC' | 'SOL';
  amountUsd: number;
  blockTime: number;
  confirmations: number | null;
  finality: string;
  verifiedAt: number;
}

export type DonationVerificationStatus = 'verified' | 'below-minimum' | 'pending' | 'not-found' | 'invalid' | 'unavailable';

export interface DonationVerificationResult {
  status: DonationVerificationStatus;
  message?: string;
  minDonationUsd?: number;
  proof?: VerifiedDonation;
  amountUsd?: number;
  asset?: string;
  amountNative?: number;
  confirmations?: number | null;
  finality?: string;
}

const DONATION_REQUEST_TIMEOUT_MS = 3_000;
const DONATION_REQUEST_RETRIES = 1;

export async function verifyDonationTransaction(
  chain: DonationChain,
  txHash: string,
  signal?: AbortSignal,
): Promise<DonationVerificationResult> {
  const body = JSON.stringify({ chain, txHash: txHash.trim() });
  let lastError: unknown;

  for (let attempt = 0; attempt <= DONATION_REQUEST_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Transaction verification cancelled.', 'AbortError');
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeoutId = setTimeout(() => controller.abort(), DONATION_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/verify-donation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (signal?.aborted) throw new DOMException('Transaction verification cancelled.', 'AbortError');
      if ((response.status === 429 || response.status >= 500) && attempt < DONATION_REQUEST_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      if (controller.signal.aborted) throw new DOMException('Transaction verification timed out.', 'TimeoutError');

      const result = await response.json() as Omit<DonationVerificationResult, 'proof'> & Record<string, unknown>;
      if (signal?.aborted) throw new DOMException('Transaction verification cancelled.', 'AbortError');
      if (!response.ok && result.status !== 'invalid') {
        throw new Error(typeof result.message === 'string' ? result.message : 'Transaction verification failed.');
      }
      if (result.status === 'verified' && typeof result.recipient === 'string'
        && typeof result.amountUsd === 'number' && typeof result.amountNative === 'number'
        && typeof result.asset === 'string' && typeof result.blockTime === 'number'
        && typeof result.finality === 'string') {
        result.proof = {
          chain,
          txHash: typeof result.txHash === 'string' ? result.txHash : txHash.trim(),
          recipient: result.recipient,
          amountNative: result.amountNative,
          asset: result.asset as VerifiedDonation['asset'],
          amountUsd: result.amountUsd,
          blockTime: result.blockTime,
          confirmations: typeof result.confirmations === 'number' ? result.confirmations : null,
          finality: result.finality,
          verifiedAt: Date.now(),
        };
      }
      return result as DonationVerificationResult;
    } catch (error) {
      if (signal?.aborted) throw error;
      const timedOut = controller.signal.aborted;
      const retryable = timedOut || error instanceof TypeError
        || (error instanceof DOMException && error.name === 'TimeoutError');
      if (retryable && attempt < DONATION_REQUEST_RETRIES) {
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Transaction verification is unavailable.');
}
