export default function Legend() {
  const chip = (cls, label) => (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-px rounded ${cls}`}>{label}</span>
  );
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      {chip('bg-green-100 text-green-800', 'raise')}
      {chip('bg-gray-100 text-gray-600', 'hold')}
      {chip('bg-red-100 text-red-800', 'lower')}
    </div>
  );
}
