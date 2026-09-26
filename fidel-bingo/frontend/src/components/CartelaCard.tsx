import React from 'react';
import { Cartela } from '../store/gameStore';
import { AppTheme } from '../store/gameSettingsStore';

interface Props {
  cartela: Cartela;
  calledNumbers: number[];
  onMark?: (cartelaId: string, number: number) => void;
  disabled?: boolean;
  theme: AppTheme;
}

const HEADERS = ['B', 'I', 'N', 'G', 'O'];

export const CartelaCard: React.FC<Props> = ({ cartela, calledNumbers, onMark, disabled, theme: t }) => {
  const handleClick = (number: number, idx: number) => {
    if (disabled || idx === 12 || cartela.patternMask[idx]) return;
    if (!calledNumbers.includes(number)) return;
    onMark?.(cartela.id, number);
  };

  return (
    <div
      className="rounded-lg p-2 lg:p-4"
      style={{
        border: `2px solid ${cartela.isWinner ? t.cartelaWinnerBorder : t.cartelaBorder}`,
        background: cartela.isWinner ? t.cartelaWinnerBg : t.cartelaBg,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
      role="grid"
      aria-label="Bingo cartela"
    >
      {/* Header */}
      <div className="grid grid-cols-5 gap-1 lg:gap-2 mb-1 lg:mb-2">
        {HEADERS.map((h) => (
          <div
            key={h}
            className="text-center font-extrabold text-sm lg:text-xl py-1 lg:py-2 rounded"
            style={{ color: t.cartelaHeaderText }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-1 lg:gap-2">
        {cartela.numbers.map((num, idx) => {
          const isFree = idx === 12;
          const isMarked = cartela.patternMask[idx];
          const isCalled = calledNumbers.includes(num);

          let bg = t.cartelaUnmarkedBg;
          let color = t.cartelaUnmarkedText;
          let border = `1px solid ${t.cartelaUnmarkedBorder}`;
          let cursor: React.CSSProperties['cursor'] = 'not-allowed';

          if (isFree) {
            bg = t.cartelaFreeBg; color = t.cartelaFreeText; border = 'none'; cursor = 'default';
          } else if (isMarked) {
            bg = t.cartelaMarkedBg; color = t.cartelaMarkedText; border = 'none'; cursor = 'default';
          } else if (isCalled) {
            bg = t.cartelaCalledBg; color = t.cartelaCalledText; border = `1px solid ${t.cartelaCalledBorder}`; cursor = 'pointer';
          }

          return (
            <button
              key={idx}
              onClick={() => handleClick(num, idx)}
              disabled={disabled || isFree || isMarked || !isCalled}
              aria-label={isFree ? 'Free space' : `Number ${num}${isMarked ? ' marked' : ''}`}
              aria-pressed={isMarked}
              style={{ background: bg, color, border, cursor }}
              className="w-full aspect-square flex items-center justify-center text-base lg:text-[clamp(1rem,2.2vw,1.75rem)] font-bold rounded lg:rounded-lg transition-all duration-150"
            >
              {isFree ? '★' : num}
            </button>
          );
        })}
      </div>

      {cartela.isWinner && (
        <div className="mt-2 text-center font-bold text-sm" style={{ color: t.cartelaWinnerText }} role="status">
          🎉 BINGO! ({cartela.winPattern})
        </div>
      )}
    </div>
  );
};
