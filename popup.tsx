import cssText from "data-text:~/styles.css"

import "./styles.css"

import { useEffect, useState } from "react"

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

const PROJECT_URL = "https://github.com/madhav2348/record-and-save"
const DEBUG_LOGS_KEY = "debugLogs"
const MAX_DEBUG_LOGS = 8

const debug = (...args: unknown[]) => {
  console.log("[record-and-save:popup]", ...args)
}

function IndexPopup() {
  const [enabled, setEnabledState] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState("Checking recording status...")

  const appendLog = async (message: string) => {
    const entry = `${new Date().toLocaleTimeString()} ${message}`

    debug(message)
    setLogs((currentLogs) => [entry, ...currentLogs].slice(0, MAX_DEBUG_LOGS))

    const result = await chrome.storage.local.get([DEBUG_LOGS_KEY])
    const storedLogs = Array.isArray(result[DEBUG_LOGS_KEY])
      ? result[DEBUG_LOGS_KEY]
      : []

    await chrome.storage.local.set({
      [DEBUG_LOGS_KEY]: [entry, ...storedLogs].slice(0, MAX_DEBUG_LOGS)
    })
  }

  useEffect(() => {
    chrome.storage.local.get(["recordEnabled", DEBUG_LOGS_KEY]).then((result) => {
      setEnabledState(result.recordEnabled === true)
      setLogs(
        Array.isArray(result[DEBUG_LOGS_KEY])
          ? result[DEBUG_LOGS_KEY].slice(0, MAX_DEBUG_LOGS)
          : []
      )
    })

    chrome.runtime
      .sendMessage({ type: "GET_RECORDING_STATUS" })
      .then((response) => {
        if (!response?.ok) {
          throw new Error(response?.error ?? "Status check failed")
        }

        setEnabledState(response.recording === true)
        setStatus(response.recording ? "Recorder is active" : "Recorder is idle")
        return chrome.storage.local.set({
          recordEnabled: response.recording === true
        })
      })
      .then(() => appendLog("Popup opened and status checked"))
      .catch((error) => {
        setStatus("Could not check recorder status")
        appendLog(
          `Status check failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        )
      })

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") {
        return
      }

      if (changes.recordEnabled) {
        setEnabledState(changes.recordEnabled.newValue === true)
      }

      if (changes[DEBUG_LOGS_KEY]) {
        setLogs(
          Array.isArray(changes[DEBUG_LOGS_KEY].newValue)
            ? changes[DEBUG_LOGS_KEY].newValue.slice(0, MAX_DEBUG_LOGS)
            : []
        )
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  const setEnabled = async (value: boolean) => {
    if (busy) {
      await appendLog("Switch click ignored because command is already running")
      return
    }

    setBusy(true)
    setStatus(value ? "Starting recorder..." : "Stopping recorder...")
    await appendLog(value ? "Switch clicked: start" : "Switch clicked: stop")

    try {
      const response = await chrome.runtime.sendMessage({
        type: value ? "START_TAB_RECORDING" : "STOP_TAB_RECORDING"
      })

      await appendLog(
        `Background response: ${response?.ok ? "ok" : (response?.error ?? "failed")}`
      )

      if (!response?.ok) {
        throw new Error(response?.error ?? "Recording command failed")
      }

      setEnabledState(value)
      setStatus(value ? "Recorder is active" : "Recorder is idle")
      await chrome.storage.local.set({ recordEnabled: value })
    } catch (error) {
      console.error("[record-and-save:popup]", error)
      setEnabledState(false)
      setStatus("Recording command failed")
      await appendLog(
        `Command failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      )
      await chrome.storage.local.set({ recordEnabled: false })
    } finally {
      setBusy(false)
    }
  }

  const openWebsite = () => {
    chrome.tabs.create({ url: PROJECT_URL })
  }

  const openSettings = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <div className="record-save-popup">
      <div className="record-save-popup-stack">
        <header className="record-save-popup-header">
          <button
            type="button"
            onClick={openWebsite}
            className="record-save-logo-button"
            title="Open Record and Save website"
            aria-label="Open Record and Save website">
            <img src="assets/icon.png" alt="" className="record-save-logo-image" />
            <span className="record-save-logo-text">Record</span>
          </button>

          <button
            type="button"
            onClick={openSettings}
            className="record-save-icon-button"
            title="Settings"
            aria-label="Settings">
            <SettingsIcon />
          </button>
        </header>

        <div className="record-save-popup-panel">
          <div>
            <div className="record-save-popup-title">Enable Recording</div>
            <div className="record-save-popup-status">{status}</div>
          </div>

          <div className="record-save-switch-row">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              disabled={busy}
              aria-checked={enabled}
              aria-label="Enable Record and Save"
              role="switch"
              className={`record-save-switch${enabled ? " is-on" : ""}`}>
              <span className="record-save-switch-thumb" />
            </button>
            <span className="record-save-switch-state">
              {enabled ? "On" : "Off"}
            </span>
          </div>
        </div>

        <div className="record-save-debug-panel">
          {logs.length > 0 ? (
            logs.map((log) => (
              <div className="record-save-debug-line" key={log}>
                {log}
              </div>
            ))
          ) : (
            <div className="record-save-debug-line">No popup logs yet</div>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default IndexPopup

