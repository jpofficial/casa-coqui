export default function UnitToggle({ unit, onChange }) {
  const btn = (val, label) => (
    <button
      type="button"
      onClick={() => onChange(val)}
      className={`px-3.5 py-1.5 text-sm font-semibold rounded-md transition ${
        unit === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-[3px]">
      {btn('unit-a', 'Unit A')}
      {btn('unit-b', 'Unit B')}
    </div>
  );
}
