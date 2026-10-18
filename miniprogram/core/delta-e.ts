import { isValidLab } from "./color";
import type { LabColor } from "./types";

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number): number => (radians * 180) / Math.PI;

function hueAngleDegrees(b: number, aPrime: number): number {
  if (aPrime === 0 && b === 0) {
    return 0;
  }
  const angle = radiansToDegrees(Math.atan2(b, aPrime));
  return angle >= 0 ? angle : angle + 360;
}

/** CIEDE2000 with the standard parametric factors kL = kC = kH = 1. */
export function deltaE2000(first: LabColor, second: LabColor): number {
  if (!isValidLab(first) || !isValidLab(second)) {
    throw new RangeError("DeltaE2000 requires finite Lab colors with L in 0..100");
  }

  const c1 = Math.hypot(first.a, first.b);
  const c2 = Math.hypot(second.a, second.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1Prime = (1 + g) * first.a;
  const a2Prime = (1 + g) * second.a;
  const c1Prime = Math.hypot(a1Prime, first.b);
  const c2Prime = Math.hypot(a2Prime, second.b);
  const h1Prime = hueAngleDegrees(first.b, a1Prime);
  const h2Prime = hueAngleDegrees(second.b, a2Prime);

  const deltaLPrime = second.l - first.l;
  const deltaCPrime = c2Prime - c1Prime;
  const rawHueDifference = h2Prime - h1Prime;
  let deltaHPrimeDegrees = 0;
  if (c1Prime !== 0 && c2Prime !== 0) {
    if (Math.abs(rawHueDifference) <= 180) {
      deltaHPrimeDegrees = rawHueDifference;
    } else if (rawHueDifference > 180) {
      deltaHPrimeDegrees = rawHueDifference - 360;
    } else {
      deltaHPrimeDegrees = rawHueDifference + 360;
    }
  }
  const deltaHPrime =
    2 *
    Math.sqrt(c1Prime * c2Prime) *
    Math.sin(degreesToRadians(deltaHPrimeDegrees / 2));

  const lBarPrime = (first.l + second.l) / 2;
  const cBarPrime = (c1Prime + c2Prime) / 2;
  let hBarPrime = h1Prime + h2Prime;
  if (c1Prime !== 0 && c2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) {
      hBarPrime = (h1Prime + h2Prime) / 2;
    } else if (h1Prime + h2Prime < 360) {
      hBarPrime = (h1Prime + h2Prime + 360) / 2;
    } else {
      hBarPrime = (h1Prime + h2Prime - 360) / 2;
    }
  }

  const t =
    1 -
    0.17 * Math.cos(degreesToRadians(hBarPrime - 30)) +
    0.24 * Math.cos(degreesToRadians(2 * hBarPrime)) +
    0.32 * Math.cos(degreesToRadians(3 * hBarPrime + 6)) -
    0.2 * Math.cos(degreesToRadians(4 * hBarPrime - 63));
  const deltaTheta =
    30 * Math.exp(-(((hBarPrime - 275) / 25) ** 2));
  const cBarPrime7 = cBarPrime ** 7;
  const rC = 2 * Math.sqrt(cBarPrime7 / (cBarPrime7 + 25 ** 7));
  const lDifference = lBarPrime - 50;
  const sL = 1 + (0.015 * lDifference ** 2) / Math.sqrt(20 + lDifference ** 2);
  const sC = 1 + 0.045 * cBarPrime;
  const sH = 1 + 0.015 * cBarPrime * t;
  const rT = -Math.sin(degreesToRadians(2 * deltaTheta)) * rC;
  const lTerm = deltaLPrime / sL;
  const cTerm = deltaCPrime / sC;
  const hTerm = deltaHPrime / sH;

  return Math.sqrt(
    lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rT * cTerm * hTerm,
  );
}
