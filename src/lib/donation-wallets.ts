// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/** Public support recipients shared by the wallet UI and transaction verifier. */
export const DONATION_WALLETS = [
  { chain: 'solana', label: 'SOL', address: '79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8' },
  { chain: 'bitcoin', label: 'BTC', address: 'bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f' },
  { chain: 'ethereum', label: 'ETH', address: '0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7' },
] as const;

export type DonationChain = (typeof DONATION_WALLETS)[number]['chain'];
export const MIN_PRO_DONATION_USD = 5;
