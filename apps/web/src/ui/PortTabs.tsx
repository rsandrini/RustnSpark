import { tablistKeys } from './tablist';

export interface PortTab {
  id: string;
  label: string;
  badge?: number | string;
}

export interface PortTabsProps {
  tabs: readonly PortTab[];
  activeId: string;
  onChange: (id: string) => void;
  /** `tabs` is the underlined strip; `segment` is the pill group used one level down. */
  variant?: 'tabs' | 'segment';
  /** An accessible name for the tab list (the two levels need different ones). */
  label?: string;
}

// Tab strip shared by the port screen (market · repair · refuel · scavenging) and
// anywhere else the shell needs one row of destinations.
export function PortTabs({ tabs, activeId, onChange, variant = 'tabs', label }: PortTabsProps) {
  return (
    <div
      className={variant === 'segment' ? 'segment' : 'tabs'}
      role="tablist"
      aria-label={label}
      onKeyDown={tablistKeys}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          className={`${variant === 'segment' ? 'seg' : 'tab'}${tab.id === activeId ? ' on' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="count">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
