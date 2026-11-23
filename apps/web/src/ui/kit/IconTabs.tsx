import type { ReactNode } from 'react';
import { tablistKeys } from '../tablist';
import { Tooltip } from './Tooltip';

export interface IconTab {
  id: string;
  icon: ReactNode;
  label: string;
}

export interface IconTabsProps {
  tabs: IconTab[];
  value: string;
  onChange: (id: string) => void;
}

/** Tabs that are only an icon each; the label is the accessible name and shows as a tooltip. */
export function IconTabs({ tabs, value, onChange }: IconTabsProps) {
  return (
    <div className="kit-tabs" role="tablist" onKeyDown={tablistKeys}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <Tooltip key={tab.id} content={tab.label}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={tab.label}
              tabIndex={selected ? 0 : -1}
              className={`kit-tab${selected ? ' on' : ''}`}
              onClick={() => onChange(tab.id)}
            >
              {tab.icon}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
