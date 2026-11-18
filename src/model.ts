import W from '../model/weights.json';
import type { Vec } from './features';

export const THRESHOLD: number = W.threshold;
export const HIDE_THRESHOLD: number = W.hideThreshold ?? W.threshold;

/** Logistic regression: p = sigmoid(bias + w . x). Weights are looked up by feature name. */
export function score(x: Vec): number {
  let z = W.bias;
  for (let i = 0; i < W.features.length; i++) {
    z += (W.weights[i] ?? 0) * (x[W.features[i] as keyof Vec] ?? 0);
  }
  return 1 / (1 + Math.exp(-z));
}
