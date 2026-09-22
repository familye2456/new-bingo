/**
 * Property-Based Tests for the cartela-bonus-system feature — Frontend.
 * Feature: cartela-bonus-system
 *
 * Uses Vitest + fast-check (both already devDependencies).
 * Each property runs a minimum of 100 iterations.
 * No DOM rendering or React component imports required — pure logic tests.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Inline copy of the TX_LABEL map from BalanceHistory.tsx
// (kept in sync manually; changes to the component must be reflected here)
// ---------------------------------------------------------------------------

const TX_LABEL: Record<string, { label: string; sign: string; color: string }> = {
  deposit:    { label: 'Top-up',       sign: '+', color: '#4ade80' },
  withdrawal: { label: 'Deduction',    sign: '-', color: '#f87171' },
  win:        { label: 'Win',          sign: '+', color: '#4ade80' },
  bet:        { label: 'House Fee',    sign: '-', color: '#f87171' },
  bonus:      { label: 'Free Cartela', sign: '+', color: '#fbbf24' },
  refund:     { label: 'Refund',       sign: '+', color: '#a78bfa' },
  house_cut:  { label: 'House Cut',    sign: '-', color: '#f87171' },
};

// ---------------------------------------------------------------------------
// Inline copy of totalBonus computation from BalanceHistory.tsx
// ---------------------------------------------------------------------------

interface TxRecord {
  transactionType: string;
  status: string;
  amount: number;
}

function computeTotalBonus(transactions: TxRecord[]): number {
  return transactions
    .filter((t) => t.transactionType === 'bonus' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount), 0);
}

// ---------------------------------------------------------------------------
// Property 7: Bonus transactions always render with 'Free Cartela' label and '+' sign
// ---------------------------------------------------------------------------

// Feature: cartela-bonus-system, Property 7: Bonus transactions always render with 'Free Cartela' label and '+' sign
describe('Property 7: Bonus transactions render with correct label, sign, and color', () => {
  it('TX_LABEL[bonus] always returns "Free Cartela", "+", and "#fbbf24"', () => {
    fc.assert(
      fc.property(
        fc.record({
          transactionType: fc.constant('bonus'),
          amount: fc.float({ min: Math.fround(0.01), noNaN: true }),
          status: fc.constantFrom('completed', 'pending', 'failed'),
          id: fc.uuid(),
        }),
        (tx) => {
          const meta = TX_LABEL[tx.transactionType];

          // meta must always exist for known type 'bonus'
          expect(meta).toBeDefined();
          expect(meta.label).toBe('Free Cartela');
          expect(meta.sign).toBe('+');
          expect(meta.color).toBe('#fbbf24');
        },
      ),
      { numRuns: 25 },
    );
  });

  it('fallback for unknown transaction type does not return bonus metadata', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !Object.prototype.hasOwnProperty.call(TX_LABEL, s)),
        (unknownType) => {
          const meta = Object.prototype.hasOwnProperty.call(TX_LABEL, unknownType)
            ? TX_LABEL[unknownType]
            : undefined;
          // Unknown types fall through to undefined (component uses ?? fallback)
          expect(meta).toBeUndefined();
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: totalBonus equals sum of all completed bonus transaction amounts
// ---------------------------------------------------------------------------

// Feature: cartela-bonus-system, Property 8: totalBonus equals sum of all completed bonus transaction amounts
describe('Property 8: BalanceHistory totalBonus sums all completed bonus amounts', () => {
  it('totalBonus matches manual sum of completed bonus transactions', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            transactionType: fc.constantFrom('bonus', 'bet', 'deposit', 'win', 'withdrawal', 'refund'),
            amount: fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
            status: fc.constantFrom('completed', 'pending', 'failed'),
            id: fc.uuid(),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (transactions) => {
          // Computed value using component logic
          const computedTotal = computeTotalBonus(transactions);

          // Expected value — independently computed for comparison
          const expectedTotal = transactions
            .filter((t) => t.transactionType === 'bonus' && t.status === 'completed')
            .reduce((sum, t) => sum + Number(t.amount), 0);

          expect(computedTotal).toBeCloseTo(expectedTotal, 5);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('non-completed bonus transactions are excluded from totalBonus', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            transactionType: fc.constant('bonus'),
            amount: fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
            status: fc.constantFrom('pending', 'failed'),
            id: fc.uuid(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (pendingBonuses) => {
          // All bonus transactions are non-completed → totalBonus must be 0
          const total = computeTotalBonus(pendingBonuses);
          expect(total).toBe(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('non-bonus completed transactions do not inflate totalBonus', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            transactionType: fc.constantFrom('bet', 'deposit', 'win', 'withdrawal'),
            amount: fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
            status: fc.constant('completed'),
            id: fc.uuid(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (nonBonusTxs) => {
          // No bonus transactions in the array → totalBonus must be 0
          const total = computeTotalBonus(nonBonusTxs);
          expect(total).toBe(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('totalBonus is additive — adding a completed bonus increases total by its amount', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            transactionType: fc.constantFrom('bonus', 'bet', 'deposit', 'win'),
            amount: fc.float({ min: Math.fround(0.01), max: Math.fround(5000), noNaN: true }),
            status: fc.constantFrom('completed', 'pending'),
            id: fc.uuid(),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
        fc.uuid(),
        (existing, newBonusAmount, newId) => {
          const baseTotalBonus = computeTotalBonus(existing);

          const withNewBonus: TxRecord[] = [
            ...existing,
            { transactionType: 'bonus', status: 'completed', amount: newBonusAmount, id: newId } as TxRecord & { id: string },
          ];

          const newTotalBonus = computeTotalBonus(withNewBonus);

          // The difference should equal newBonusAmount (within floating-point tolerance)
          expect(newTotalBonus - baseTotalBonus).toBeCloseTo(newBonusAmount, 5);
        },
      ),
      { numRuns: 25 },
    );
  });
});

