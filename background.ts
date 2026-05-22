const OFFSCREEN_DOCUMENT_PATH = "public/offscreen.html"
const DOWNLOAD_URL_TTL_MS = 10 * 60 * 1000

const activeDownloads = new Map<
  number,
  {
    filename: string
    timeoutId: ReturnType<typeof setTimeout>
    url: string
  }
>()

const debug = (...args: unknown[]) => {
  console.log("[record-and-save:background]", ...args)
}

type RecordingMessage = {
  filename?: string
  mimeType?: string
  size?: number
  type:
    | "GET_RECORDING_STATUS"
    | "START_TAB_RECORDING"
    | "STOP_TAB_RECORDING"
    | "OFFSCREEN_RECORDING_READY"
  url?: string
}

const requestOffscreenUrlRevoke = async (url: string, reason: string) => {
  debug("Requesting offscreen URL revoke", { reason })

  try {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_REVOKE_RECORDING_URL",
      url,
      reason
    })
  } catch (error) {
    console.warn("[record-and-save:background] Failed to revoke offscreen URL", {
      error,
      reason
    })
  }
}

const forgetActiveDownload = (downloadId: number, reason: string) => {
  const download = activeDownloads.get(downloadId)

  if (!download) {
    return
  }

  clearTimeout(download.timeoutId)
  activeDownloads.delete(downloadId)
  requestOffscreenUrlRevoke(download.url, reason)
}

const downloadRecordingUrl = async (message: RecordingMessage) => {
  if (!message.url || !message.filename) {
    throw new Error("Recording download message is missing a URL or filename")
  }

  debug("Starting recording download", {
    filename: message.filename,
    mimeType: message.mimeType,
    size: message.size
  })

  const downloadId = await chrome.downloads.download({
    url: message.url,
    filename: message.filename,
    conflictAction: "uniquify",
    saveAs: false
  })

  const timeoutId = setTimeout(() => {
    console.warn("[record-and-save:background] Download did not finish in time", {
      downloadId,
      filename: message.filename
    })
    forgetActiveDownload(downloadId, "timeout")
  }, DOWNLOAD_URL_TTL_MS)

  activeDownloads.set(downloadId, {
    filename: message.filename,
    timeoutId,
    url: message.url
  })

  debug("Download started", {
    downloadId,
    filename: message.filename
  })

  return downloadId
}

const hasOffscreenDocument = async () => {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  })

  debug("Checked offscreen document", {
    exists: contexts.length > 0,
    url: offscreenUrl
  })

  return contexts.length > 0
}

const ensureOffscreenDocument = async () => {
  if (await hasOffscreenDocument()) {
    debug("Reusing existing offscreen document")
    return
  }

  debug("Creating offscreen document", { path: OFFSCREEN_DOCUMENT_PATH })

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the active Chrome tab after the popup switch is enabled."
  })

  debug("Created offscreen document")
}

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  })

  if (!tab?.id) {
    throw new Error("No active tab found")
  }

  debug("Found active tab", {
    id: tab.id,
    url: tab.url,
    title: tab.title
  })

  return tab
}

const getTabMediaStreamId = (tabId: number) =>
  new Promise<string>((resolve, reject) => {
    debug("Requesting tab media stream id", { tabId })

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        debug("Failed to get tab media stream id", {
          tabId,
          error: chrome.runtime.lastError.message
        })
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      debug("Received tab media stream id", {
        tabId,
        hasStreamId: Boolean(streamId)
      })
      resolve(streamId)
    })
  })

const startTabRecording = async () => {
  debug("Starting tab recording")

  const tab = await getActiveTab()
  await ensureOffscreenDocument()

  const streamId = await getTabMediaStreamId(tab.id)

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START_TAB_RECORDING",
    streamId,
    tabId: tab.id
  })

  debug("Offscreen start response", response)

  if (!response?.ok) {
    throw new Error(response?.error ?? "Offscreen start failed")
  }
}

const stopTabRecording = async () => {
  if (!(await hasOffscreenDocument())) {
    debug("Stop ignored because offscreen document does not exist")
    return
  }

  debug("Stopping tab recording")

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_STOP_TAB_RECORDING"
  })

  debug("Offscreen stop response", response)

  if (!response?.ok) {
    throw new Error(response?.error ?? "Offscreen stop failed")
  }
}

const getRecordingStatus = async () => {
  if (!(await hasOffscreenDocument())) {
    return { recording: false }
  }

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_GET_RECORDING_STATUS"
  })

  debug("Offscreen status response", response)

  return { recording: response?.recording === true }
}

chrome.runtime.onMessage.addListener(
  (message: RecordingMessage, _sender, sendResponse) => {
    if (
      message?.type !== "GET_RECORDING_STATUS" &&
      message?.type !== "START_TAB_RECORDING" &&
      message?.type !== "STOP_TAB_RECORDING" &&
      message?.type !== "OFFSCREEN_RECORDING_READY"
    ) {
      return false
    }

    const run = async () => {
      debug("Received message", { type: message.type })

      if (message.type === "GET_RECORDING_STATUS") {
        const status = await getRecordingStatus()
        sendResponse({ ok: true, ...status })
        return
      }

      if (message.type === "START_TAB_RECORDING") {
        await startTabRecording()
        sendResponse({ ok: true })
        return
      }

      if (message.type === "STOP_TAB_RECORDING") {
        await stopTabRecording()
        sendResponse({ ok: true })
        return
      }

      const downloadId = await downloadRecordingUrl(message)
      sendResponse({ ok: true, downloadId })
    }

    run().catch((error) => {
      console.error("[record-and-save:background]", error)
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      })
    })

    return true
  }
)

chrome.downloads.onChanged.addListener((delta) => {
  if (!activeDownloads.has(delta.id)) {
    return
  }

  if (delta.state?.current === "complete") {
    debug("Download completed", { downloadId: delta.id })
    forgetActiveDownload(delta.id, "complete")
    return
  }

  if (delta.state?.current === "interrupted") {
    console.warn("[record-and-save:background] Download interrupted", {
      downloadId: delta.id,
      error: delta.error
    })
    forgetActiveDownload(delta.id, "interrupted")
  }
})
