import React from 'react';

interface Props {
  calledNumbers: number[];
  lastNumber?: number | null;
}

// B=1-15, I=16-30, N=31-45, G=46-60, O=61-75
const ROWS = [
  { letter: 'B', start: 1 },
  { letter: 'I', start: 16 },
  { letter: 'N', start: 31 },
  { letter: 'G', start: 46 },
  { letter: 'O', start: 61 },
];

export const NumberBoard: React.FC<Props> = ({ calledNumbers, lastNumber }) => {
  return (
    <div
      className="rounded-2xl overflow-hidden w-full"
      style={{ background: '#0d0d0d', padding: '8px' }}
      role="region"
      aria-label="Bingo number board"
    >
      {ROWS.map(({ letter, start }) => (
        <div key={letter} className="flex items-center gap-0.5 sm:gap-1 mb-0.5 sm:mb-1 last:mb-0">
          {/* Letter chip */}
          <div
            className="flex items-center justify-center font-extrabold text-gray-900 rounded-lg shrink-0"
            style={{
              width: 'clamp(26px, 5vw, 44px)',
              height: 'clamp(26px, 5vw, 44px)',
              background: 'linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%)',
              fontSize: 'clamp(12px, 2.5vw, 22px)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
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
                className="flex items-center justify-center font-bold rounded-md transition-all duration-300 flex-1 aspect-square"
                style={{
                  fontSize: 'clamp(7px, 1.5vw, 15px)',
                  background: isLast
                    ? 'linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%)'
                    : called
                    ? 'linear-gradient(180deg, #ca8a04 0%, #a16207 100%)'
                    : 'linear-gradient(180deg, #991b1b 0%, #7f1d1d 100%)',
                  color: isLast ? '#1a1a1a' : called ? '#1a1a1a' : '#fff',
                  boxShadow: isLast
                    ? '0 0 12px rgba(251,191,36,0.7)'
                    : called
                    ? '0 0 8px rgba(202,138,4,0.5)'
                    : '0 2px 4px rgba(0,0,0,0.4)',
                  border: isLast ? '2px solid #fbbf24' : called ? '1px solid #fbbf24' : '1px solid rgba(0,0,0,0.3)',
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
      <div className="text-center mt-2 text-xs text-gray-500">
        {calledNumbers.length} / 75 called
      </div>
    </div>
  );
};
