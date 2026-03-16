import React from 'react';
import { Cartela } from '../store/gameStore';

interface Props {
  cartela: Cartela;
  calledNumbers: number[];
  onMark?: (cartelaId: string, number: number) => void;
  disabled?: boolean;
}

const HEADERS = ['B', 'I', 'N', 'G', 'O'];

export const CartelaCard: React.FC<Props> = ({ cartela, calledNumbers, onMark, disabled }) => {
  const handleClick = (number: number, idx: number) => {
    if (disabled || idx === 12 || cartela.patternMask[idx]) return;
    if (!calledNumbers.includes(number)) return;
    onMark?.(cartela.id, number);
  };

  return (
    <div
      className={`border-2 rounded-lg p-2 ${cartela.isWinner ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300 bg-white'}`}
      role="grid"
      aria-label="Bingo cartela"
    >
      {/* Header */}
      <div className="grid grid-cols-5 gap-1 mb-1">
        {HEADERS.map((h) => (
          <div key={h} className="text-center font-bold text-blue-600 text-sm py-1">
            {h}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-1">
        {cartela.numbers.map((num, idx) => {
          const isFree = idx === 12;
          const isMarked = cartela.patternMask[idx];
          const isCalled = calledNumbers.includes(num);

          return (
            <button
              key={idx}
              onClick={() => handleClick(num, idx)}
              disabled={disabled || isFree || isMarked || !isCalled}
              aria-label={isFree ? 'Free space' : `Number ${num}${isMarked ? ' marked' : ''}`}
              aria-pressed={isMarked}
              className={`
                w-full aspect-square flex items-center justify-center text-sm font-semibold rounded
                transition-colors duration-150
                ${isFree ? 'bg-blue-500 text-white cursor-default' : ''}
                ${isMarked && !isFree ? 'bg-green-500 text-white' : ''}
                ${!isMarked && !isFree && isCalled ? 'bg-yellow-200 hover:bg-yellow-300 cursor-pointer' : ''}
                ${!isMarked && !isFree && !isCalled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}
              `}
            >
              {isFree ? '★' : num}
            </button>
          );
        })}
      </div>

      {cartela.isWinner && (
        <div className="mt-2 text-center text-yellow-600 font-bold text-sm" role="status">
          🎉 BINGO! ({cartela.winPattern})
        </div>
      )}
    </div>
  );
};
