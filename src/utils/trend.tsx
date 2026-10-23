import { bwExtraLoadKg, type Exercise } from './parser'
import { type WeightUnit, formatWeightDiff } from './settings'
import { TrendItem } from '../components/TrendItem'

/** A line's change against the last time it was done, as trend badges — or null for none. */
export function buildTrend(current: Exercise, prev: Exercise, unit: WeightUnit, showDown: boolean): React.ReactNode | null {
  const setsDiff = current.sets - prev.sets
  const repsDiff = current.reps - prev.reps

  // Compare load above bodyweight, not absolute weight: this suppresses raw
  // bodyweight drift between days (plain bw → plain bw stays flat) while still
  // catching genuine added load (bw → bw+6 reads as +6kg).
  // Threshold is 0.05 (half the 0.1kg display precision) so decimal/microplate
  // changes still register, and a true 0.5kg jump isn't dropped by float error.
  const curLoad = current.bodyweight ? bwExtraLoadKg(current) : current.weightKg
  const prevLoad = prev.bodyweight ? bwExtraLoadKg(prev) : prev.weightKg
  const rawWeight = curLoad - prevLoad
  const weightDiff = Math.abs(rawWeight) >= 0.05 ? rawWeight : 0

  const parts: { key: string; diff: number; label: React.ReactNode }[] = [
    { key: 's', diff: setsDiff, label: `${Math.abs(setsDiff)} set${Math.abs(setsDiff) !== 1 ? 's' : ''}` },
    { key: 'r', diff: repsDiff, label: `${Math.abs(repsDiff)} rep${Math.abs(repsDiff) !== 1 ? 's' : ''}` },
    { key: 'w', diff: weightDiff, label: formatWeightDiff(Math.abs(weightDiff), unit) },
  ].filter(p => p.diff !== 0 && (p.diff > 0 || showDown))

  if (parts.length === 0) return null
  return <>{parts.map(p => (
    <TrendItem key={p.key} diff={p.diff} size={13}>{p.label}</TrendItem>
  ))}</>
}
