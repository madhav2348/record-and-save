const OFFSCREEN_DOCUMENT_PATH = "public/offscreen.html"

type RecordingMessage = {
  type: "START_TAB_RECORDING" | "STOP_TAB_RECORDING"
}

const hasOffscreenDocument = async () => {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  })

  return contexts.length > 0
}

const ensureOffscreenDocument = async () => {
  if (await hasOffscreenDocument()) {
    return
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the active Chrome tab after the popup switch is enabled."
  })
}

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  })

  if (!tab?.id) {
    throw new Error("No active tab found")
  }

  return tab
}

const getTabMediaStreamId = (tabId: number) =>
  new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      resolve(streamId)
    })
  })

const startTabRecording = async () => {
  const tab = await getActiveTab()
  await ensureOffscreenDocument()

  const streamId = await getTabMediaStreamId(tab.id)

  await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START_TAB_RECORDING",
    streamId,
    tabId: tab.id
  })
}

const stopTabRecording = async () => {
  if (!(await hasOffscreenDocument())) {
    return
  }

  await chrome.runtime.sendMessage({
    type: "OFFSCREEN_STOP_TAB_RECORDING"
  })
}

chrome.runtime.onMessage.addListener(
  (message: RecordingMessage, _sender, sendResponse) => {
    if (
      message?.type !== "START_TAB_RECORDING" &&
      message?.type !== "STOP_TAB_RECORDING"
    ) {
      return false
    }

    const run = async () => {
      if (message.type === "START_TAB_RECORDING") {
        await startTabRecording()
      } else {
        await stopTabRecording()
      }

      sendResponse({ ok: true })
    }

    run().catch((error) => {
      console.error(error)
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      })
    })

    return true
  }
)
