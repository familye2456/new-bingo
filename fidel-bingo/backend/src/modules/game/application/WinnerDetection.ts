/**
 * Detects winning patterns on a 5x5 bingo cartela.
 * Numbers stored as flat array (row-major), index = row*5+col.
 *
 * A "line" is any of:
 *   - a complete row (5 in a row)
 *   - a complete column (5 in a column)
 *   - a complete diagonal (main or anti)
 *   - four corners
 *
 * Patterns:
 *   line1      — at least 1 line
 *   line2      — at least 2 lines
 *   line3      — at least 3 lines
 *   fullhouse  — all 25 cells marked
 *   fourCorners — four corners only (alias for 1 line = corners)
 */
export class WinnerDetection {

  /** Returns how many distinct lines are complete on this mask */
  countLines(mask: boolean[]): number {
    let count = 0;
    // Rows
    for (let r = 0; r < 5; r++) {
      if ([0,1,2,3,4].every(c => mask[r*5+c])) count++;
    }
    // Columns
    for (let c = 0; c < 5; c++) {
      if ([0,1,2,3,4].every(r => mask[r*5+c])) count++;
    }
    // Main diagonal
    if ([0,6,12,18,24].every(i => mask[i])) count++;
    // Anti diagonal
    if ([4,8,12,16,20].every(i => mask[i])) count++;
    // Four corners
    if (mask[0] && mask[4] && mask[20] && mask[24]) count++;
    return count;
  }

  checkWin(mask: boolean[], pattern: string = 'line1'): boolean {
    switch (pattern) {
      case 'line1':      return this.countLines(mask) >= 1;
      case 'line2':      return this.countLines(mask) >= 2;
      case 'line3':      return this.countLines(mask) >= 3;
      case 'fullhouse':  return mask.every(Boolean);
      case 'fourCorners': return mask[0] && mask[4] && mask[20] && mask[24];
      // legacy aliases
      case 'any':        return this.countLines(mask) >= 1;
      case 'row':        return [0,1,2,3,4].some(r => [0,1,2,3,4].every(c => mask[r*5+c]));
      case 'column':     return [0,1,2,3,4].some(c => [0,1,2,3,4].every(r => mask[r*5+c]));
      case 'diagonal':   return [0,6,12,18,24].every(i => mask[i]) || [4,8,12,16,20].every(i => mask[i]);
      case 'blackout':   return mask.every(Boolean);
      default:           return this.countLines(mask) >= 1;
    }
  }

  /** Returns a human-readable label for the first completed line(s) */
  getWinPattern(mask: boolean[]): string | null {
    const lines = this.countLines(mask);
    if (lines === 0) return null;
    if (mask.every(Boolean)) return 'fullhouse';
    if (lines >= 3) return 'line3';
    if (lines >= 2) return 'line2';
    return 'line1';
  }
}
