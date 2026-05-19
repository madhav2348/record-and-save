import cssText from "data-text:~/styles.css"

import "./styles.css"

import { useEffect, useState } from "react"

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

const OFFICIAL_WEBSITE_URL = "https://ask-llm-extension.vercel.app"

function IndexPopup() {
  const [enabled, setEnabledState] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(["recordEnabled"]).then((result) => {
      setEnabledState(result.recordEnabled === true)
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
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  const setEnabled = async (value: boolean) => {
    if (busy) {
      return
    }

    setBusy(true)

    try {
      const response = await chrome.runtime.sendMessage({
        type: value ? "START_TAB_RECORDING" : "STOP_TAB_RECORDING"
      })

      if (!response?.ok) {
        throw new Error(response?.error ?? "Recording command failed")
      }

      setEnabledState(value)
      await chrome.storage.local.set({ recordEnabled: value })
    } catch (error) {
      console.error(error)
      setEnabledState(false)
      await chrome.storage.local.set({ recordEnabled: false })
    } finally {
      setBusy(false)
    }
  }

  const openWebsite = () => {
    chrome.tabs.create({ url: OFFICIAL_WEBSITE_URL })
  }

  const openSettings = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <div className="ask-llm-popup">
      <div className="ask-llm-popup-stack">
        <header className="ask-llm-popup-header">
          <button
            type="button"
            onClick={openWebsite}
            className="ask-llm-logo-button"
            title="Open Ask LLM website"
            aria-label="Open Ask LLM website">
            <img
              src={chrome.runtime.getURL("assets/icon.png")}
              alt=""
              className="ask-llm-logo-image"
            />
            <span className="ask-llm-logo-text">Ask LLM</span>
          </button>

          <button
            type="button"
            onClick={openSettings}
            className="ask-llm-icon-button"
            title="Settings"
            aria-label="Settings">
            <SettingsIcon />
          </button>
        </header>

        <div className="ask-llm-popup-panel">
          <div>
            <div className="ask-llm-popup-title">Enable Recording</div>
          </div>

          <div className="ask-llm-switch-row">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              disabled={busy}
              aria-checked={enabled}
              aria-label="Enable Ask LLM"
              role="switch"
              className={`ask-llm-switch${enabled ? " is-on" : ""}`}>
              <span className="ask-llm-switch-thumb" />
            </button>
            <span className="ask-llm-switch-state">
              {enabled ? "On" : "Off"}
            </span>
          </div>
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
