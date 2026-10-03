// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DonationChain } from '@/lib/donation-wallets';
import type { VerifiedDonation } from '@/api/verify-donation';
import { appStorage } from './storage';

type VerificationState = 'locked' | 'checking' | 'verified' | 'unavailable';

const PRO_EXPORT_ENTITLEMENT_KEY = 'nc-nodecluster-pro-export-v1';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function exportEntitlementPayload(proof: VerifiedDonation, salt: string): string {
  return [
    'nodechart-pro-export-v1',
    proof.chain,
    proof.txHash.trim().toLowerCase(),
    String(Number(proof.verifiedAt)),
    String(Number(proof.amountUsd)),
    proof.recipient.trim().toLowerCase(),
    String(Number(proof.amountNative)),
    String(Number(proof.blockTime)),
    proof.asset,
    salt,
  ].join('|');
}

async function writeExportEntitlement(proof: VerifiedDonation | null): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!proof) {
    try { window.localStorage.removeItem(PRO_EXPORT_ENTITLEMENT_KEY); } catch { /* export stays watermarked */ }
    return;
  }
  try {
    const webCrypto = globalThis.crypto;
    if (!webCrypto?.subtle || typeof webCrypto.getRandomValues !== 'function') throw new Error('Web Crypto unavailable');
    const salt = bytesToHex(webCrypto.getRandomValues(new Uint8Array(16)));
    const digest = await webCrypto.subtle.digest('SHA-256', new TextEncoder().encode(exportEntitlementPayload(proof, salt)));
    const hash = bytesToHex(new Uint8Array(digest));
    window.localStorage.setItem(PRO_EXPORT_ENTITLEMENT_KEY, JSON.stringify({
      version: 1,
      status: 'verified',
      chain: proof.chain,
      txHash: proof.txHash,
      verifiedAt: proof.verifiedAt,
      salt,
      digest: hash,
    }));
  } catch {
    // No Web Crypto or blocked storage means the canvas fails closed to watermark.
    try { window.localStorage.removeItem(PRO_EXPORT_ENTITLEMENT_KEY); } catch { /* best effort */ }
  }
}

interface ProAccessState {
  proof: VerifiedDonation | null;
  verification: VerificationState;
  message: string | null;
  setChecking: () => void;
  grant: (proof: VerifiedDonation) => Promise<void>;
  setUnavailable: (message: string) => void;
  lock: (message?: string | null) => void;
}

function isDonationProof(value: unknown): value is VerifiedDonation {
  if (!value || typeof value !== 'object') return false;
  const proof = value as Partial<VerifiedDonation>;
  return (proof.chain === 'ethereum' || proof.chain === 'bitcoin' || proof.chain === 'solana')
    && typeof proof.txHash === 'string' && proof.txHash.length <= 100
    && typeof proof.recipient === 'string' && proof.recipient.length <= 64
    && typeof proof.amountNative === 'number' && Number.isFinite(proof.amountNative) && proof.amountNative > 0
    && (proof.asset === 'ETH' || proof.asset === 'BTC' || proof.asset === 'SOL')
    && typeof proof.amountUsd === 'number' && Number.isFinite(proof.amountUsd) && proof.amountUsd >= 5
    && typeof proof.blockTime === 'number' && Number.isFinite(proof.blockTime) && proof.blockTime > 0
    && typeof proof.verifiedAt === 'number' && Number.isFinite(proof.verifiedAt);
}

export const useProAccessStore = create<ProAccessState>()(
  persist(
    (set) => ({
      proof: null,
      verification: 'locked',
      message: null,
      setChecking: () => {
        void writeExportEntitlement(null);
        set({ verification: 'checking', message: null });
      },
      grant: async (proof) => {
        await writeExportEntitlement(proof);
        set({ proof, verification: 'verified', message: null });
      },
      setUnavailable: (message) => {
        void writeExportEntitlement(null);
        set({ verification: 'unavailable', message });
      },
      lock: (message = null) => {
        void writeExportEntitlement(null);
        set({ proof: null, verification: 'locked', message });
      },
    }),
    {
      name: 'nc-pro-access-v1',
      storage: appStorage,
      partialize: (state) => ({ proof: state.proof }),
      merge: (persisted, current) => {
        // A persisted transaction hash is only a claim until ProAccessGuard rechecks it.
        void writeExportEntitlement(null);
        const value = (persisted ?? {}) as { proof?: unknown };
        return {
          ...current,
          proof: isDonationProof(value.proof) ? value.proof : null,
          verification: 'locked',
          message: null,
        };
      },
    },
  ),
);

export const selectProAccessProof = (state: ProAccessState) => state.proof;
export const selectProAccessStatus = (state: ProAccessState) => state.verification;
export const selectProAccessMessage = (state: ProAccessState) => state.message;
export const selectProUnlocked = (state: ProAccessState) => state.verification === 'verified' && state.proof !== null;

export function supportedDonationChain(value: unknown): value is DonationChain {
  return value === 'ethereum' || value === 'bitcoin' || value === 'solana';
}
