/**
 * Generates a shuffled grid of numbers 1-50 for the honeycomb layout.
 * Grid is a flat array; the frontend arranges it into hex rows.
 */
export function generateGrid(): number[] {
  const nums = Array.from({ length: 50 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

