/**
 * Detects winning patterns on a 5x5 bingo cartela.
 * Numbers stored as flat array (row-major), index = row*5+col.
 *
 * Patterns:
 *   line1       — at least 1 line (row/col/diagonal/corners)
 *   line2       — at least 2 lines
 *   line3       — at least 3 lines
 *   fullhouse   — all 25 cells marked
 *   fourCorners — four corners
 *   X           — both diagonals
 *   plus        — middle row + middle column
 *   T           — top row + middle column
 *   L           — left column + bottom row
 *   frame       — all 16 outer edge cells
 */
export class WinnerDetection {

  /** Returns how many distinct lines are complete on this mask */
  countLines(mask: boolean[]): number {
    let count = 0;
    for (let r = 0; r < 5; r++) {
      if ([0,1,2,3,4].every(c => mask[r*5+c])) count++;
    }
    for (let c = 0; c < 5; c++) {
      if ([0,1,2,3,4].every(r => mask[r*5+c])) count++;
    }
    if ([0,6,12,18,24].every(i => mask[i])) count++;
    if ([4,8,12,16,20].every(i => mask[i])) count++;
    if (mask[0] && mask[4] && mask[20] && mask[24]) count++;
    return count;
  }

  checkWin(mask: boolean[], pattern: string = 'line1'): boolean {
    switch (pattern) {
      case 'line1':      return this.countLines(mask) >= 1;
      case 'line2':      return this.countLines(mask) >= 2;
      case 'line3':      return this.countLines(mask) >= 3;
      case 'fullhouse':
      case 'blackout':   return mask.every(Boolean);
      case 'fourCorners': return mask[0] && mask[4] && mask[20] && mask[24];
      // X — both diagonals
      case 'X':          return [0,6,12,18,24].every(i => mask[i]) && [4,8,12,16,20].every(i => mask[i]);
      // Plus — middle row (row 2) + middle column (col 2)
      case 'plus':       return [10,11,12,13,14].every(i => mask[i]) && [2,7,12,17,22].every(i => mask[i]);
      // T — top row + middle column
      case 'T':          return [0,1,2,3,4].every(i => mask[i]) && [2,7,12,17,22].every(i => mask[i]);
      // L — left column + bottom row
      case 'L':          return [0,5,10,15,20].every(i => mask[i]) && [20,21,22,23,24].every(i => mask[i]);
      // Frame — all 16 outer edge cells
      case 'frame':      return [0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24].every(i => mask[i]);
      // legacy aliases
      case 'any':        return this.countLines(mask) >= 1;
      case 'row':        return [0,1,2,3,4].some(r => [0,1,2,3,4].every(c => mask[r*5+c]));
      case 'column':     return [0,1,2,3,4].some(c => [0,1,2,3,4].every(r => mask[r*5+c]));
      case 'diagonal':   return [0,6,12,18,24].every(i => mask[i]) || [4,8,12,16,20].every(i => mask[i]);
      default:           return this.countLines(mask) >= 1;
    }
  }

  /** Returns a human-readable label for the best completed pattern */
  getWinPattern(mask: boolean[]): string | null {
    if (mask.every(Boolean)) return 'fullhouse';
    if (this.checkWin(mask, 'frame')) return 'frame';
    if (this.checkWin(mask, 'X')) return 'X';
    if (this.checkWin(mask, 'plus')) return 'plus';
    if (this.checkWin(mask, 'T')) return 'T';
    if (this.checkWin(mask, 'L')) return 'L';
    if (this.checkWin(mask, 'fourCorners')) return 'fourCorners';
    const lines = this.countLines(mask);
    if (lines === 0) return null;
    if (lines >= 3) return 'line3';
    if (lines >= 2) return 'line2';
    return 'line1';
  }
}
