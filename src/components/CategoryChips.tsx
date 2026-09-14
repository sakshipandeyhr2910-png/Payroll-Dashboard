import type { CategoryFilter } from '../types';

interface Props {
  filter: CategoryFilter;
  onChange: (filter: CategoryFilter) => void;
  allCount: number;
  whiteCount: number;
  blueCount: number;
}

export default function CategoryChips({ filter, onChange, allCount, whiteCount, blueCount }: Props) {
  return (
    <div className="chip-row">
      <button className={`chip${filter === 'All' ? ' on' : ''}`} onClick={() => onChange('All')}>
        All ({allCount})
      </button>
      <button className={`chip${filter === 'White' ? ' on' : ''}`} onClick={() => onChange('White')}>
        White Collar ({whiteCount})
      </button>
      <button className={`chip${filter === 'Blue' ? ' on' : ''}`} onClick={() => onChange('Blue')}>
        Blue Collar ({blueCount})
      </button>
    </div>
  );
}
