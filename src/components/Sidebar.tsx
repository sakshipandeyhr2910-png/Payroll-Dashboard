import { ENTITIES } from '../data/entities';
import type { TabId } from '../App';

interface Props {
  activeTab: TabId;
  onNavigate: (tab: TabId) => void;
}

export default function Sidebar({ activeTab, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-title">KOENIG</div>
        <div className="brand-sub">Payroll Dashboard</div>
      </div>
      <div className="sidebar-scroll">
        <ul className="navlist">
          <li>
            <a
              className={`navlink${activeTab === 'overview' ? ' active' : ''}`}
              onClick={() => onNavigate('overview')}
            >
              <span className="ic">★</span>
              <span>Overview</span>
            </a>
          </li>
        </ul>
        <div className="nav-section-label">Entities</div>
        <ul className="navlist">
          {ENTITIES.map((e) => (
            <li key={e.slug}>
              <a
                className={`navlink${activeTab === e.slug ? ' active' : ''}`}
                onClick={() => onNavigate(e.slug)}
              >
                <span className="ic">★</span>
                <span>{e.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="sidebar-foot">
        Koenig Solutions
        <br />
        Automated Payroll Processing Engine
      </div>
    </aside>
  );
}
