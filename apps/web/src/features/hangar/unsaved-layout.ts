/**
 * Whether the hangar holds layout edits the pilot has not saved. Kept outside React so the flight
 * watcher (mounted for the whole app) can ask before it takes the pilot away from the screen.
 */
let unsaved = false;

export function setUnsavedLayout(value: boolean): void {
  unsaved = value;
}

export function hasUnsavedLayout(): boolean {
  return unsaved;
}
