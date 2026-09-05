export interface ShellState {
  paused: boolean;
}

export const shellState: ShellState = {
  paused: false,
};

export function togglePaused(): boolean {
  shellState.paused = !shellState.paused;
  return shellState.paused;
}
