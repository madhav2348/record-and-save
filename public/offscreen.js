let recorder = null
let stream = null
let chunks = []

const stopTracks = () => {
  if (!stream) {
    return
  }

  stream.getTracks().forEach((track) => track.stop())
  stream = null
}

const downloadRecording = (blob) => {
  const url = URL.createObjectURL(blob)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

  chrome.downloads.download(
    {
      url,
      filename: `tab-recording-${timestamp}.webm`,
      saveAs: true
    },
    () => {
      URL.revokeObjectURL(url)
    }
  )
}

const startRecording = async (streamId) => {
  if (recorder?.state === "recording") {
    return
  }

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

  chunks = []
  recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp8,opus"
  })

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" })
    chunks = []
    stopTracks()

    if (blob.size > 0) {
      downloadRecording(blob)
    }
  }

  recorder.start()
}

const stopRecording = () => {
  if (recorder?.state === "recording") {
    recorder.stop()
    return
  }

  stopTracks()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_START_TAB_RECORDING") {
    startRecording(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error(error)
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
