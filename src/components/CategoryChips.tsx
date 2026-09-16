import type { CategoryFilter } from '../types';

interface Props {
  filter: CategoryFilter;
  onChange: (filter: CategoryFilter) => void;
  allCount: number;
}

export default function CategoryChips({ filter, onChange, allCount }: Props) {
  return (
    <div className="chip-row">
      <button className={`chip${filter === 'All' ? ' on' : ''}`} onClick={() => onChange('All')}>
        All ({allCount})
      </button>
    </div>
  );
}
