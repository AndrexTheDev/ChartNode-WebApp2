// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef } from 'react';
import { verifyDonationTransaction } from '@/api/verify-donation';
import { selectProAccessProof, selectProAccessStatus, useProAccessStore } from '@/store/useProAccessStore';

/** Revalidates the public chain proof after reload; Pro stays locked until it answers. */
export function ProAccessGuard() {
  const proof = useProAccessStore(selectProAccessProof);
  const verification = useProAccessStore(selectProAccessStatus);
  const verificationRef = useRef(verification);
  const setChecking = useProAccessStore((state) => state.setChecking);
  const grant = useProAccessStore((state) => state.grant);
  const setUnavailable = useProAccessStore((state) => state.setUnavailable);
  const lock = useProAccessStore((state) => state.lock);
  const inFlightKey = useRef('');
  const attemptedKey = useRef('');

  useEffect(() => {
    verificationRef.current = verification;
  }, [verification]);

  useEffect(() => {
    if (!proof) {
      inFlightKey.current = '';
      attemptedKey.current = '';
      return;
    }

    const key = `${proof.chain}:${proof.txHash}`;
    if (attemptedKey.current === key || inFlightKey.current === key) return;
    // A freshly submitted transaction was verified by the modal already; only
    // persisted proofs (rehydrated as `locked`) need this mount-time roundtrip.
    if (verificationRef.current === 'verified') {
      attemptedKey.current = key;
      return;
    }
    inFlightKey.current = key;
    const controller = new AbortController();
    setChecking();

    void verifyDonationTransaction(proof.chain, proof.txHash, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        attemptedKey.current = key;
        if (result.status === 'verified' && result.proof) {
          await grant(result.proof);
        } else if (result.status === 'pending' || result.status === 'unavailable') {
          setUnavailable(result.message || 'Transaction verification is temporarily unavailable.');
        } else {
          lock(result.message || 'The saved transaction no longer qualifies for Pro access.');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          attemptedKey.current = key;
          setUnavailable(error instanceof Error ? error.message : 'Transaction verification is temporarily unavailable.');
        }
      })
      .finally(() => {
        if (inFlightKey.current === key) inFlightKey.current = '';
      });

    return () => {
      controller.abort();
      if (inFlightKey.current === key) inFlightKey.current = '';
    };
  }, [proof, setChecking, grant, setUnavailable, lock]);

  return null;
}
