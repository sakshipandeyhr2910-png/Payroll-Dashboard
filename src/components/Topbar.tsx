import { useState, type KeyboardEvent } from 'react';

interface Props {
  onSearchSubmit: (value: string) => void;
  onLogout: () => void;
}

export default function Topbar({ onSearchSubmit, onLogout }: Props) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchSubmit(value);
    }
  };

  return (
    <header className="topbar">
      <div className="search-box">
        <input
          placeholder="Search an entity…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="topbar-right">
        <div className="user-chip">
          <div className="user-avatar">SP</div>
          Sakshi Pandey
        </div>
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}
