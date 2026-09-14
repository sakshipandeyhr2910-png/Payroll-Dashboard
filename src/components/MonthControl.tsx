import { stepMonth } from '../utils/month';

interface Props {
  selectedMonth: string;
  onChange: (month: string) => void;
}

export default function MonthControl({ selectedMonth, onChange }: Props) {
  return (
    <div className="month-control">
      <button
        className="month-arrow"
        title="Previous month"
        onClick={() => onChange(stepMonth(selectedMonth, -1))}
      >
        ‹
      </button>
      <input
        type="month"
        className="month-input"
        min="2024-01"
        max="2028-12"
        value={selectedMonth}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
      />
      <button
        className="month-arrow"
        title="Next month"
        onClick={() => onChange(stepMonth(selectedMonth, 1))}
      >
        ›
      </button>
    </div>
  );
}
