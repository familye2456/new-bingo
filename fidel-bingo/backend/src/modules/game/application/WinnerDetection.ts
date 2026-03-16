/**
 * Detects winning patterns on a 5x5 bingo cartela.
 * Numbers stored as flat array (row-major), index = row*5+col.
 */
export class WinnerDetection {
  checkWin(mask: boolean[], pattern: string = 'any'): boolean {
    switch (pattern) {
      case 'row': return this.hasRow(mask);
      case 'column': return this.hasColumn(mask);
      case 'diagonal': return this.hasDiagonal(mask);
      case 'fourCorners': return this.hasFourCorners(mask);
      case 'blackout': return mask.every(Boolean);
      case 'any':
      default:
        return this.hasRow(mask) || this.hasColumn(mask) || this.hasDiagonal(mask);
    }
  }

  getWinPattern(mask: boolean[]): string | null {
    if (this.hasRow(mask)) return 'row';
    if (this.hasColumn(mask)) return 'column';
    if (this.hasDiagonal(mask)) return 'diagonal';
    if (this.hasFourCorners(mask)) return 'fourCorners';
    if (mask.every(Boolean)) return 'blackout';
    return null;
  }

  private hasRow(mask: boolean[]): boolean {
    for (let r = 0; r < 5; r++) {
      if ([0, 1, 2, 3, 4].every((c) => mask[r * 5 + c])) return true;
    }
    return false;
  }

  private hasColumn(mask: boolean[]): boolean {
    for (let c = 0; c < 5; c++) {
      if ([0, 1, 2, 3, 4].every((r) => mask[r * 5 + c])) return true;
    }
    return false;
  }

  private hasDiagonal(mask: boolean[]): boolean {
    const main = [0, 6, 12, 18, 24].every((i) => mask[i]);
    const anti = [4, 8, 12, 16, 20].every((i) => mask[i]);
    return main || anti;
  }

  private hasFourCorners(mask: boolean[]): boolean {
    return mask[0] && mask[4] && mask[20] && mask[24];
  }
}
