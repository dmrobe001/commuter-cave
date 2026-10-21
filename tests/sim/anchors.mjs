import { ROLES, HAND_DRILL } from '../../src/craft.js';
const ncdf = x => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x ** 3)));
const spindle = { straightness: 0.95, moisture: 0.1, length: 70 };
const ideal = { density: 0.3, moisture: 0.1, resin: 0.05, notch: 0.8 };
const marginal = { density: 0.58, moisture: 0.18, resin: 0.1, notch: 0.8 };
for (const [label, skill, board] of [['novice, ideal hearth', 0.05, ideal], ['novice, marginal', 0.05, marginal], ['expert, marginal', 0.9, marginal], ['expert, ideal', 0.9, ideal]]) {
  const mean = Math.log(ROLES.hearth(board, skill)) + Math.log(ROLES.spindle(spindle, skill)) + 0.6 * Math.log(board.notch) + HAND_DRILL.kSkill * skill;
  const sd = 1 - 0.7 * skill;
  console.log(`${label.padEnd(22)} hearth suitability ${ROLES.hearth(board, skill).toFixed(2)}  P(ember per attempt) = ${(100 * (1 - ncdf((HAND_DRILL.theta - mean) / sd))).toFixed(1)}%`);
}
