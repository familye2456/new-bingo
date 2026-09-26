import React from 'react';
import { AppTheme } from '../store/gameSettingsStore';

interface Props {
  calledNumbers: number[];
  lastNumber?: number | null;
  theme: AppTheme;
}

// B=1-15, I=16-30, N=31-45, G=46-60, O=61-75
const ROWS = [
  { letter: 'B', start: 1 },
  { letter: 'I', start: 16 },
  { letter: 'N', start: 31 },
  { letter: 'G', start: 46 },
  { letter: 'O', start: 61 },
];

export const NumberBoard: React.FC<Props> = ({ calledNumbers, lastNumber, theme: t }) => {
  return (
    <div
      className="rounded-2xl overflow-hidden w-full"
      style={{ background: t.boardBg, border: `2px solid ${t.boardBorder}`, padding: '8px' }}
      role="region"
      aria-label="Bingo number board"
    >
      {ROWS.map(({ letter, start }) => (
        <div key={letter} className="flex items-center gap-0.5 sm:gap-1 mb-0.5 sm:mb-1 last:mb-0">
          {/* Letter chip */}
          <div
            className="flex items-center justify-center font-extrabold rounded-lg shrink-0"
            style={{
              width: 'clamp(28px, 5.5vw, 52px)',
              height: 'clamp(28px, 5.5vw, 52px)',
              background: t.letterChipBg,
              color: t.letterChipText,
              fontSize: 'clamp(13px, 2.8vw, 26px)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            }}
          >
            {letter}
          </div>

          {/* 15 number cells */}
          {Array.from({ length: 15 }, (_, i) => {
            const num = start + i;
            const called = calledNumbers.includes(num);
            const isLast = num === lastNumber;

            return (
              <div
                key={num}
                aria-label={`${num}${called ? ' called' : ''}`}
                className="flex items-center justify-center font-bold rounded-md transition-all duration-300 flex-1 aspect-square md:font-extrabold"
                style={{
                  fontSize: 'clamp(8px, 1.8vw, 25px)',
                  background: isLast ? t.cellLastBg : called ? t.cellCalledBg : t.cellUncalledBg,
                  color: isLast ? t.cellLastText : called ? t.cellCalledText : t.cellUncalledText,
                  boxShadow: isLast
                    ? `0 0 12px ${t.cellLastGlow}`
                    : called
                    ? '0 0 8px rgba(22,163,74,0.4)'
                    : '0 1px 3px rgba(0,0,0,0.1)',
                  border: `${isLast ? '2px' : '1px'} solid ${isLast ? t.cellLastBorder : called ? t.cellCalledBorder : t.cellUncalledBorder}`,
                  transform: isLast ? 'scale(1.1)' : 'scale(1)',
                }}
              >
                {num}
              </div>
            );
          })}
        </div>
      ))}

      {/* Called count */}
      <div className="text-center mt-2 text-xs" style={{ color: t.boardCountText }}>
        {calledNumbers.length} / 75 called
      </div>
    </div>
  );
};
