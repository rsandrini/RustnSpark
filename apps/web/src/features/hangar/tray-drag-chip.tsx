/** The name of the part being pulled out of the list, following the pointer (decoration only). */
export function TrayDragChip({ name, x, y }: { name: string; x: number; y: number }) {
  return (
    <div className="tray-drag-chip" aria-hidden="true" style={{ left: x, top: y }}>
      {name}
    </div>
  );
}
