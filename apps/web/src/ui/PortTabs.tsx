export interface PortTab {
  id: string;
  label: string;
  badge?: number | string;
}

export interface PortTabsProps {
  tabs: readonly PortTab[];
  activeId: string;
  onChange: (id: string) => void;
}

// Tab strip shared by the port screen (market · repair · refuel · scavenging) and
// anywhere else the shell needs one row of destinations.
export function PortTabs({ tabs, activeId, onChange }: PortTabsProps) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab${tab.id === activeId ? ' on' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="count">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
