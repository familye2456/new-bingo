/**
 * Generates valid BINGO cartelas.
 * B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
 * Center (index 12) is FREE space.
 */
export class CartelaGenerator {
  generate(): number[] {
    const ranges = [
      [1, 15],   // B
      [16, 30],  // I
      [31, 45],  // N
      [46, 60],  // G
      [61, 75],  // O
    ];

    const numbers: number[] = [];

    for (let col = 0; col < 5; col++) {
      const [min, max] = ranges[col];
      const colNums = this.sample(min, max, 5);
      for (let row = 0; row < 5; row++) {
        numbers.push(colNums[row]);
      }
    }

    // Flatten to row-major order: numbers[row * 5 + col]
    const grid: number[] = Array(25).fill(0);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        grid[row * 5 + col] = numbers[col * 5 + row];
      }
    }

    grid[12] = 0; // FREE space
    return grid;
  }

  generateMask(): boolean[] {
    const mask = Array(25).fill(false);
    mask[12] = true; // FREE space pre-marked
    return mask;
  }

  private sample(min: number, max: number, count: number): number[] {
    const pool: number[] = [];
    for (let i = min; i <= max; i++) pool.push(i);
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  }
}
