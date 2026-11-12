import Badge from './Badge';

const TONE = { low: 'ok', medium: 'warn', high: 'bad' };
const LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

export default function RiskBadge({ score, level }) {
  if (score == null) return null;
  return <Badge tone={TONE[level] || 'neutral'}>{LABEL[level] || 'Risk'} · {score}</Badge>;
}
