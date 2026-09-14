export default function StatusBadge({ value }) {
  const raw = String(value || '');
  const label = raw === 'already_present' ? 'already present' : raw;
  const cls = raw === 'already_present' ? 'already-present' : raw.toLowerCase();
  return <span className={`badge ${cls}`}>{label}</span>;
}
