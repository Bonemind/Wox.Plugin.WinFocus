import koffi from "koffi"
import path from "path"
import { WindowInfo, WindowProvider } from "./windowProvider.js"
import { encodePNG } from "../iconEncoder.js"

const SW_RESTORE = 9
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MAX_TITLE = 512
const MAX_PATH = 260
const VK_F15 = 0x7e
const KEYEVENTF_KEYUP = 0x0002
const SHGFI_ICON = 0x100
const DI_NORMAL = 0x3
const DIB_RGB_COLORS = 0
const ICON_SIZE = 32

// Module-level struct definitions (koffi names must be globally unique per process)
const SHFILEINFOW_T = koffi.struct("WF_SHFILEINFOW", {
  hIcon: "void *",
  iIcon: "int32_t",
  dwAttributes: "uint32_t",
  szDisplayName: koffi.array("char16_t", 260),
  szTypeName: koffi.array("char16_t", 80)
})

const BITMAPINFOHEADER_T = koffi.struct("WF_BITMAPINFOHEADER", {
  biSize: "uint32_t",
  biWidth: "int32_t",
  biHeight: "int32_t",
  biPlanes: "uint16_t",
  biBitCount: "uint16_t",
  biCompression: "uint32_t",
  biSizeImage: "uint32_t",
  biXPelsPerMeter: "int32_t",
  biYPelsPerMeter: "int32_t",
  biClrUsed: "uint32_t",
  biClrImportant: "uint32_t"
})

const SHFILEINFOW_SIZE = koffi.sizeof(SHFILEINFOW_T)

interface ProcessInfo {
  name: string
  exePath: string
}

interface SHFileInfoW {
  hIcon: unknown
  iIcon: number
  dwAttributes: number
  szDisplayName: number[]
  szTypeName: number[]
}

export class WindowsProvider implements WindowProvider {
  private readonly user32: koffi.IKoffiLib
  private readonly kernel32: koffi.IKoffiLib
  private readonly shell32: koffi.IKoffiLib
  private readonly gdi32: koffi.IKoffiLib

  private readonly EnumWindowsProc: koffi.IKoffiCType
  private readonly fnEnumWindows: koffi.KoffiFunction
  private readonly fnGetWindowTextW: koffi.KoffiFunction
  private readonly fnGetWindowTextLengthW: koffi.KoffiFunction
  private readonly fnIsWindowVisible: koffi.KoffiFunction
  private readonly fnSetForegroundWindow: koffi.KoffiFunction
  private readonly fnShowWindow: koffi.KoffiFunction
  private readonly fnIsIconic: koffi.KoffiFunction
  private readonly fnKeybdEvent: koffi.KoffiFunction
  private readonly fnGetWindowThreadProcessId: koffi.KoffiFunction
  private readonly fnOpenProcess: koffi.KoffiFunction
  private readonly fnQueryFullProcessImageNameW: koffi.KoffiFunction
  private readonly fnCloseHandle: koffi.KoffiFunction

  private readonly fnSHGetFileInfoW: koffi.KoffiFunction
  private readonly fnGetDC: koffi.KoffiFunction
  private readonly fnReleaseDC: koffi.KoffiFunction
  private readonly fnDrawIconEx: koffi.KoffiFunction
  private readonly fnDestroyIcon: koffi.KoffiFunction
  private readonly fnCreateCompatibleDC: koffi.KoffiFunction
  private readonly fnCreateDIBSection: koffi.KoffiFunction
  private readonly fnSelectObject: koffi.KoffiFunction
  private readonly fnGetDIBits: koffi.KoffiFunction
  private readonly fnDeleteObject: koffi.KoffiFunction
  private readonly fnDeleteDC: koffi.KoffiFunction
  private readonly fnGdiFlush: koffi.KoffiFunction

  private readonly iconCache = new Map<string, string | null>()

  constructor() {
    this.user32 = koffi.load("user32.dll")
    this.kernel32 = koffi.load("kernel32.dll")
    this.shell32 = koffi.load("shell32.dll")
    this.gdi32 = koffi.load("gdi32.dll")

    this.EnumWindowsProc = koffi.proto("bool __stdcall(intptr_t hWnd, intptr_t lParam)")

    this.fnEnumWindows = this.user32.func("bool __stdcall EnumWindows(void* lpEnumFunc, intptr_t lParam)")
    this.fnGetWindowTextW = this.user32.func("int __stdcall GetWindowTextW(intptr_t hWnd, _Out_ char16_t* lpString, int nMaxCount)")
    this.fnGetWindowTextLengthW = this.user32.func("int __stdcall GetWindowTextLengthW(intptr_t hWnd)")
    this.fnIsWindowVisible = this.user32.func("bool __stdcall IsWindowVisible(intptr_t hWnd)")
    this.fnSetForegroundWindow = this.user32.func("bool __stdcall SetForegroundWindow(intptr_t hWnd)")
    this.fnShowWindow = this.user32.func("bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)")
    this.fnIsIconic = this.user32.func("bool __stdcall IsIconic(intptr_t hWnd)")
    this.fnKeybdEvent = this.user32.func("void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)")
    this.fnGetWindowThreadProcessId = this.user32.func("uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t* lpdwProcessId)")
    this.fnOpenProcess = this.kernel32.func("void* __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)")
    this.fnQueryFullProcessImageNameW = this.kernel32.func("bool __stdcall QueryFullProcessImageNameW(void* hProcess, uint32_t dwFlags, _Out_ char16_t* lpExeName, _Inout_ uint32_t* lpdwSize)")
    this.fnCloseHandle = this.kernel32.func("bool __stdcall CloseHandle(void* hObject)")

    this.fnSHGetFileInfoW = this.shell32.func("uintptr_t __stdcall SHGetFileInfoW(str16 pszPath, uint32_t dwFileAttributes, _Out_ WF_SHFILEINFOW* psfi, uint32_t cbFileInfo, uint32_t uFlags)")
    this.fnGetDC = this.user32.func("void* __stdcall GetDC(void* hWnd)")
    this.fnReleaseDC = this.user32.func("int32_t __stdcall ReleaseDC(void* hWnd, void* hDC)")
    this.fnDrawIconEx = this.user32.func(
      "bool __stdcall DrawIconEx(void* hdc, int32_t xLeft, int32_t yTop, void* hIcon, int32_t cxWidth, int32_t cyWidth, uint32_t istepIfAniCur, void* hbrFlickerFreeDraw, uint32_t diFlags)"
    )
    this.fnDestroyIcon = this.user32.func("bool __stdcall DestroyIcon(void* hIcon)")
    this.fnCreateCompatibleDC = this.gdi32.func("void* __stdcall CreateCompatibleDC(void* hdc)")
    this.fnCreateDIBSection = this.gdi32.func("void* __stdcall CreateDIBSection(void* hdc, _In_ WF_BITMAPINFOHEADER* pbmi, uint32_t iUsage, _Out_ void** ppvBits, void* hSection, uint32_t offset)")
    this.fnSelectObject = this.gdi32.func("void* __stdcall SelectObject(void* hdc, void* h)")
    this.fnGetDIBits = this.gdi32.func("int __stdcall GetDIBits(void* hdc, void* hbm, uint32_t start, uint32_t cLines, void* lpvBits, _In_ WF_BITMAPINFOHEADER* lpbmi, uint32_t usage)")
    this.fnDeleteObject = this.gdi32.func("bool __stdcall DeleteObject(void* ho)")
    this.fnDeleteDC = this.gdi32.func("bool __stdcall DeleteDC(void* hdc)")
    this.fnGdiFlush = this.gdi32.func("bool __stdcall GdiFlush()")
  }

  async listWindows(): Promise<WindowInfo[]> {
    const windows: WindowInfo[] = []
    const titleBuf = new Uint16Array(MAX_TITLE)
    const decoder = new TextDecoder("utf-16le")

    const callback = koffi.register((hwnd: number | bigint) => {
      if (!this.fnIsWindowVisible(hwnd)) return true

      const len: number = this.fnGetWindowTextLengthW(hwnd)
      if (len <= 0) return true

      titleBuf.fill(0)
      this.fnGetWindowTextW(hwnd, titleBuf, Math.min(len + 1, MAX_TITLE))
      const title = decoder.decode(titleBuf.slice(0, len)).replace(/\0/g, "").trim()
      if (!title) return true

      const info = this.getProcessInfo(hwnd)
      windows.push({
        id: String(hwnd),
        title,
        processName: info?.name,
        icon: info?.exePath ? this.getWindowIcon(info.exePath) ?? undefined : undefined
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
    // Inject a synthetic keystroke so Windows grants our process permission
    // to call SetForegroundWindow from a non-foreground process.
    this.fnKeybdEvent(VK_F15, 0, 0, 0)
    this.fnKeybdEvent(VK_F15, 0, KEYEVENTF_KEYUP, 0)
    if (this.fnIsIconic(hwnd)) {
      this.fnShowWindow(hwnd, SW_RESTORE)
    }
    this.fnSetForegroundWindow(hwnd)
  }

  private getWindowIcon(exePath: string): string | null {
    if (this.iconCache.has(exePath)) return this.iconCache.get(exePath) ?? null
    const icon = this.extractIcon(exePath)
    this.iconCache.set(exePath, icon)
    return icon
  }

  private extractIcon(exePath: string): string | null {
    try {
      const sfi = {} as SHFileInfoW
      const ret = this.fnSHGetFileInfoW(exePath, 0, sfi, SHFILEINFOW_SIZE, SHGFI_ICON)
      if (!ret || !sfi.hIcon) return null

      try {
        return this.renderIconToPng(sfi.hIcon)
      } finally {
        this.fnDestroyIcon(sfi.hIcon)
      }
    } catch {
      return null
    }
  }

  private renderIconToPng(hIcon: unknown): string | null {
    const bmi = {
      biSize: koffi.sizeof(BITMAPINFOHEADER_T),
      biWidth: ICON_SIZE,
      biHeight: -ICON_SIZE, // top-down
      biPlanes: 1,
      biBitCount: 32,
      biCompression: 0, // BI_RGB
      biSizeImage: 0,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0
    }

    const hdcScreen = this.fnGetDC(null)
    const hdcMem = this.fnCreateCompatibleDC(hdcScreen)
    const ppvBitsOut: unknown[] = [null]
    const hbmDib = this.fnCreateDIBSection(hdcScreen, bmi, DIB_RGB_COLORS, ppvBitsOut, null, 0)

    if (!hbmDib) {
      this.fnDeleteDC(hdcMem)
      this.fnReleaseDC(null, hdcScreen)
      return null
    }

    const hbmOld = this.fnSelectObject(hdcMem, hbmDib)
    this.fnDrawIconEx(hdcMem, 0, 0, hIcon, ICON_SIZE, ICON_SIZE, 0, null, DI_NORMAL)
    this.fnGdiFlush()

    const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4)
    this.fnGetDIBits(hdcMem, hbmDib, 0, ICON_SIZE, pixels, bmi, DIB_RGB_COLORS)

    this.fnSelectObject(hdcMem, hbmOld)
    this.fnDeleteObject(hbmDib)
    this.fnDeleteDC(hdcMem)
    this.fnReleaseDC(null, hdcScreen)

    // Check if any alpha is set (old-style icons have no alpha)
    let hasAlpha = false
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) {
        hasAlpha = true
        break
      }
    }

    // Convert BGRA → RGBA
    const rgba = new Uint8Array(pixels.length)
    for (let i = 0; i < pixels.length; i += 4) {
      rgba[i] = pixels[i + 2] // R
      rgba[i + 1] = pixels[i + 1] // G
      rgba[i + 2] = pixels[i] // B
      rgba[i + 3] = hasAlpha ? pixels[i + 3] : 255
    }

    return encodePNG(ICON_SIZE, ICON_SIZE, rgba)
  }

  private getProcessInfo(hwnd: number | bigint): ProcessInfo | undefined {
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

        const decoder = new TextDecoder("utf-16le")
        const fullPath = decoder.decode(nameBuf.slice(0, sizeOut[0])).replace(/\0/g, "")
        return { name: path.basename(fullPath, ".exe"), exePath: fullPath }
      } finally {
        this.fnCloseHandle(handle)
      }
    } catch {
      return undefined
    }
  }
}
