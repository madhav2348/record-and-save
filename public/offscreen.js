let recorder = null
let stream = null
let chunks = []
const activeRecordingUrls = new Set()

const debug = (...args) => {
  console.debug("[record-and-save:offscreen]", ...args)
}

const warn = (...args) => {
  console.warn("[record-and-save:offscreen]", ...args)
}

const errorLog = (...args) => {
  console.error("[record-and-save:offscreen]", ...args)
}

const revokeRecordingUrl = (url, reason) => {
  if (!activeRecordingUrls.has(url)) {
    return
  }

  URL.revokeObjectURL(url)
  activeRecordingUrls.delete(url)
  debug("Revoked recording object URL", { reason })
}

const stopTracks = () => {
  if (!stream) {
    debug("No stream tracks to stop")
    return
  }

  const tracks = stream.getTracks()
  debug("Stopping stream tracks", {
    audioTracks: tracks.filter((track) => track.kind === "audio").length,
    videoTracks: tracks.filter((track) => track.kind === "video").length
  })

  tracks.forEach((track) => track.stop())
  stream = null
}

const downloadRecording = (blob) => {
  const url = URL.createObjectURL(blob)
  activeRecordingUrls.add(url)

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `tab-recording-${timestamp}.webm`

  debug("Sending recording URL to background for download", {
    filename,
    size: blob.size,
    type: blob.type
  })

  chrome.runtime.sendMessage(
    {
      type: "OFFSCREEN_RECORDING_READY",
      url,
      filename,
      size: blob.size,
      mimeType: blob.type
    },
    (response) => {
      if (chrome.runtime.lastError) {
        errorLog("Failed to send recording URL", chrome.runtime.lastError.message)
        revokeRecordingUrl(url, "send-message-error")
        return
      }

      if (!response?.ok) {
        errorLog("Background failed to start download", response?.error)
        revokeRecordingUrl(url, "download-start-error")
        return
      }

      debug("Background accepted recording download", {
        downloadId: response.downloadId,
        filename
      })
    }
  )
}

const startRecording = async (streamId) => {
  if (recorder?.state === "recording") {
    debug("Start ignored because recorder is already recording")
    return
  }

  debug("Requesting tab media stream", { hasStreamId: Boolean(streamId) })

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    }
  })

  const tracks = stream.getTracks()
  debug("Tab media stream acquired", {
    audioTracks: tracks.filter((track) => track.kind === "audio").length,
    videoTracks: tracks.filter((track) => track.kind === "video").length
  })

  chunks = []
  const preferredMimeType = "video/webm;codecs=vp8,opus"
  const mimeType = MediaRecorder.isTypeSupported(preferredMimeType)
    ? preferredMimeType
    : "video/webm"

  debug("Creating MediaRecorder", { mimeType })

  recorder = new MediaRecorder(stream, { mimeType })

  recorder.ondataavailable = (event) => {
    debug("Recorder data available", { size: event.data.size })

    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  recorder.onerror = (event) => {
    errorLog("Recorder error", event.error ?? event)
  }

  recorder.onstop = () => {
    debug("Recorder stopped", {
      chunks: chunks.length,
      totalBytes: chunks.reduce((total, chunk) => total + chunk.size, 0)
    })

    const blob = new Blob(chunks, { type: mimeType })
    chunks = []
    stopTracks()

    if (blob.size > 0) {
      downloadRecording(blob)
      return
    }

    warn("Skipping download because recording blob is empty")
  }

  recorder.start()
  debug("Recorder started", { state: recorder.state })
}

const stopRecording = () => {
  if (recorder?.state === "recording") {
    debug("Stopping recorder")
    recorder.stop()
    return
  }

  debug("Stop requested while recorder is not recording", {
    state: recorder?.state ?? "none"
  })
  stopTracks()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  debug("Received message", { type: message?.type })

  if (message?.type === "OFFSCREEN_REVOKE_RECORDING_URL") {
    revokeRecordingUrl(message.url, message.reason ?? "background-request")
    sendResponse({ ok: true })
    return false
  }

  if (message?.type === "OFFSCREEN_START_TAB_RECORDING") {
    startRecording(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        errorLog("Start recording failed", error)
        sendResponse({ ok: false, error: error.message })
      })

    return true
  }

  if (message?.type === "OFFSCREEN_STOP_TAB_RECORDING") {
    stopRecording()
    sendResponse({ ok: true })
    return true
  }

  return false
})
