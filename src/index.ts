import { Context, Plugin, PluginInitParams, PublicAPI, Query, Result } from "@wox-launcher/wox-plugin"
import { WindowProvider } from "./providers/windowProvider.js"
import { WINDOW_ICON } from "./icons.js"

let api: PublicAPI
let provider: WindowProvider | null = null

async function loadProvider(): Promise<WindowProvider | null> {
  switch (process.platform) {
    case "win32": {
      const { WindowsProvider } = await import("./providers/windows.js")
      return new WindowsProvider()
    }
    default:
      return null
  }
}

export const plugin: Plugin = {
  init: async (ctx: Context, initParams: PluginInitParams) => {
    api = initParams.API
    try {
      provider = await loadProvider()
      if (!provider) {
        await api.Log(ctx, "Warning", `Unsupported platform: ${process.platform}`)
      }
    } catch (e) {
      await api.Log(ctx, "Error", `Failed to load window provider: ${e}`)
    }
  },

  query: async (ctx: Context, query: Query): Promise<Result[]> => {
    if (!provider) {
      return [
        {
          Title: `Platform '${process.platform}' is not supported yet`,
          SubTitle: "Only Windows is currently supported",
          Icon: WINDOW_ICON,
          Actions: []
        }
      ]
    }

    let windows
    try {
      windows = await provider.listWindows()
    } catch (e) {
      await api.Log(ctx, "Error", `Failed to list windows: ${e}`)
      return []
    }

    const search = query.Search.toLowerCase().trim()
    const filtered = search ? windows.filter(w => w.title.toLowerCase().includes(search) || w.processName?.toLowerCase().includes(search)) : windows

    return filtered.map(w => ({
      Title: w.title,
      SubTitle: w.processName ?? "",
      Icon: WINDOW_ICON,
      Actions: [
        {
          Id: "focus",
          Name: "Focus Window",
          IsDefault: true,
          Action: async (actionCtx: Context) => {
            await provider!.focusWindow(w.id)
            await api.HideApp(actionCtx)
          }
        }
      ]
    }))
  }
}
