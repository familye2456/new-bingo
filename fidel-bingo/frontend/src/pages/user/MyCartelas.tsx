import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { offlineUserApi } from '../../services/offlineApi';

const COLS = ['B', 'I', 'N', 'G', 'O'];

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  numbers: number[];
  isActive: boolean;
  assignedAt: string;
}

const BingoCard: React.FC<{ cartela: CartelaRecord }> = ({ cartela }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-20 h-20 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 font-bold text-sm hover:scale-105 transition-transform shadow flex items-center justify-center">
        #{cartela.cardNumber ?? '?'}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-[#1e1e1e] rounded-2xl p-5 w-72 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-yellow-400 font-bold text-lg mb-3">Card #{cartela.cardNumber}</div>
            <div className="grid grid-cols-5 gap-1 mb-1">
              {COLS.map((c) => (
                <div key={c} className="flex items-center justify-center rounded-lg aspect-square text-sm font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">
                  {c}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {cartela.numbers.map((num, idx) => {
                const isFree = idx === 12;
                return (
                  <div key={idx}
                    className={`flex items-center justify-center rounded-lg aspect-square text-sm font-bold
                      ${isFree ? 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900' : 'bg-[#3a3a3a] text-white'}`}>
                    {isFree ? 'FREE' : num}
                  </div>
                );
              })}
            </div>
            <button onClick={() => setOpen(false)}
              className="mt-4 w-full bg-gray-700 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-600">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const MyCartelas: React.FC = () => {
  const { data: cartelas = [], isLoading } = useQuery<CartelaRecord[]>({
    queryKey: ['my-cartelas'],
    queryFn: async () => {
      const list = await offlineUserApi.myCartelas();
      return [...list].sort((a, b) => (a.cardNumber ?? 0) - (b.cardNumber ?? 0));
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">My Cartelas</h1>
        <span className="text-sm text-gray-500">{cartelas.length} cards assigned</span>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : cartelas.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🎴</div>
          <div className="text-sm">No cartelas assigned yet. Contact admin.</div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {cartelas.map((c) => <BingoCard key={c.id} cartela={c} />)}
        </div>
      )}
    </div>
  );
};
