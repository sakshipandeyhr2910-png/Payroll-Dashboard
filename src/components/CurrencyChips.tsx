export type CurrencyFilterValue = 'All' | string;

interface Props {
  currencies: string[];
  filter: CurrencyFilterValue;
  onChange: (filter: CurrencyFilterValue) => void;
  countFor: (currency: string) => number;
  allCount: number;
}

export default function CurrencyChips({ currencies, filter, onChange, countFor, allCount }: Props) {
  return (
    <div className="chip-row">
      <button className={`chip${filter === 'All' ? ' on' : ''}`} onClick={() => onChange('All')}>
        All Currencies ({allCount})
      </button>
      {currencies.map((c) => (
        <button
          key={c}
          className={`chip${filter === c ? ' on' : ''}`}
          onClick={() => onChange(c)}
        >
          {c} ({countFor(c)})
        </button>
      ))}
    </div>
  );
}
