import koffi from 'koffi'
import path from 'path'
import { WindowInfo, WindowProvider } from './windowProvider.js'

const SW_RESTORE = 9
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MAX_TITLE = 512
const MAX_PATH = 260

export class WindowsProvider implements WindowProvider {
  private readonly user32: koffi.IKoffiLib
  private readonly kernel32: koffi.IKoffiLib

  private readonly EnumWindowsProc: koffi.KoffiType
  private readonly fnEnumWindows: koffi.KoffiFunction
  private readonly fnGetWindowTextW: koffi.KoffiFunction
  private readonly fnGetWindowTextLengthW: koffi.KoffiFunction
  private readonly fnIsWindowVisible: koffi.KoffiFunction
  private readonly fnSetForegroundWindow: koffi.KoffiFunction
  private readonly fnShowWindow: koffi.KoffiFunction
  private readonly fnIsIconic: koffi.KoffiFunction
  private readonly fnGetWindowThreadProcessId: koffi.KoffiFunction
  private readonly fnOpenProcess: koffi.KoffiFunction
  private readonly fnQueryFullProcessImageNameW: koffi.KoffiFunction
  private readonly fnCloseHandle: koffi.KoffiFunction

  constructor() {
    this.user32 = koffi.load('user32.dll')
    this.kernel32 = koffi.load('kernel32.dll')

    this.EnumWindowsProc = koffi.proto('EnumWindowsProc', 'bool __stdcall(intptr_t hWnd, intptr_t lParam)')

    this.fnEnumWindows = this.user32.func('bool __stdcall EnumWindows(EnumWindowsProc* lpEnumFunc, intptr_t lParam)')
    this.fnGetWindowTextW = this.user32.func('int __stdcall GetWindowTextW(intptr_t hWnd, _Out_ char16_t* lpString, int nMaxCount)')
    this.fnGetWindowTextLengthW = this.user32.func('int __stdcall GetWindowTextLengthW(intptr_t hWnd)')
    this.fnIsWindowVisible = this.user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)')
    this.fnSetForegroundWindow = this.user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)')
    this.fnShowWindow = this.user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)')
    this.fnIsIconic = this.user32.func('bool __stdcall IsIconic(intptr_t hWnd)')
    this.fnGetWindowThreadProcessId = this.user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t* lpdwProcessId)')
    this.fnOpenProcess = this.kernel32.func('void* __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)')
    this.fnQueryFullProcessImageNameW = this.kernel32.func('bool __stdcall QueryFullProcessImageNameW(void* hProcess, uint32_t dwFlags, _Out_ char16_t* lpExeName, _Inout_ uint32_t* lpdwSize)')
    this.fnCloseHandle = this.kernel32.func('bool __stdcall CloseHandle(void* hObject)')
  }

  async listWindows(): Promise<WindowInfo[]> {
    const windows: WindowInfo[] = []
    const titleBuf = new Uint16Array(MAX_TITLE)
    const decoder = new TextDecoder('utf-16le')

    const callback = koffi.register((hwnd: number | bigint) => {
      if (!this.fnIsWindowVisible(hwnd)) return true

      const len: number = this.fnGetWindowTextLengthW(hwnd)
      if (len <= 0) return true

      titleBuf.fill(0)
      this.fnGetWindowTextW(hwnd, titleBuf, Math.min(len + 1, MAX_TITLE))
      const title = decoder.decode(titleBuf.slice(0, len)).replace(/\0/g, '').trim()
      if (!title) return true

      windows.push({
        id: String(hwnd),
        title,
        processName: this.getProcessName(hwnd),
      })

      return true
    }, koffi.pointer(this.EnumWindowsProc))

    try {
      this.fnEnumWindows(callback, 0)
    } finally {
      koffi.unregister(callback)
    }

    return windows
  }

  async focusWindow(id: string): Promise<void> {
    const hwnd = Number(id)
    if (this.fnIsIconic(hwnd)) {
      this.fnShowWindow(hwnd, SW_RESTORE)
    }
    this.fnSetForegroundWindow(hwnd)
  }

  private getProcessName(hwnd: number | bigint): string | undefined {
    try {
      const pidOut = [0]
      this.fnGetWindowThreadProcessId(hwnd, pidOut)
      const pid = pidOut[0]
      if (!pid) return undefined

      const handle = this.fnOpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
      if (!handle) return undefined

      try {
        const nameBuf = new Uint16Array(MAX_PATH)
        const sizeOut = [MAX_PATH]
        const ok: boolean = this.fnQueryFullProcessImageNameW(handle, 0, nameBuf, sizeOut)
        if (!ok) return undefined

        const decoder = new TextDecoder('utf-16le')
        const fullPath = decoder.decode(nameBuf.slice(0, sizeOut[0])).replace(/\0/g, '')
        return path.basename(fullPath, '.exe')
      } finally {
        this.fnCloseHandle(handle)
      }
    } catch {
      return undefined
    }
  }
}
