import type { ReactNode } from 'react';

export interface ItemCardProps {
  icon?: ReactNode;
  name: string;
  description?: ReactNode;
  action?: ReactNode;
}

// Generic list row (quadro/porto prototypes' `.item`): icon, text block, right-hand
// action slot. Presentation only — callers pass server-rendered values.
export function ItemCard({ icon, name, description, action }: ItemCardProps) {
  return (
    <div className="item">
      <div className="ico" aria-hidden="true">
        {icon}
      </div>
      <div>
        <div className="name">{name}</div>
        {description !== undefined && <div className="desc">{description}</div>}
      </div>
      <div className="act">{action}</div>
    </div>
  );
}
