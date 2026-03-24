export interface WindowInfo {
  id: string
  title: string
  processName?: string
}

export interface WindowProvider {
  listWindows(): Promise<WindowInfo[]>
  focusWindow(id: string): Promise<void>
}
