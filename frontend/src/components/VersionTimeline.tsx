// frontend/src/components/VersionTimeline.tsx
import React, { useState } from "react";
import "../assets/VersionTimeline.css";

interface Version {
  version: number;
  commit_hash: string;
  message: string;
  timestamp: string;
}

export type { Version };

interface VersionTimelineProps {
  versions: Version[];
  currentVersion: number | null;
  onSelectVersion: (version: number) => void;
  disabled?: boolean;
}

export default function VersionTimeline({
  versions,
  currentVersion,
  onSelectVersion,
  disabled = false,
}: VersionTimelineProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentVersionData = versions.find((v) => v.version === currentVersion);
  const currentLabel = currentVersionData
    ? `v${currentVersionData.version}`
    : "No version selected";

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleSelect = (version: number) => {
    if (disabled) return;
    onSelectVersion(version);
    setIsOpen(false);
  };

  return (
    <div className="version-timeline">
      <span className="version-label">Version History</span>

      <div className="version-dropdown-container">
        <button
          className={`version-dropdown-trigger ${isOpen ? "open" : ""} ${disabled ? "disabled" : ""}`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
        >
          <div className="version-trigger-content">
            <svg
              className="version-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
                clipRule="evenodd"
              />
            </svg>
            <span className="version-trigger-text">{currentLabel}</span>
          </div>
          <svg
            className={`version-chevron ${isOpen ? "rotated" : ""}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {isOpen && versions.length > 0 && (
          <div className="version-dropdown-menu">
            {versions.map((version, index) => {
              const isSelected = version.version === currentVersion;
              const isLatest = index === versions.length - 1;

              return (
                <button
                  key={version.commit_hash}
                  className={`version-item ${isSelected ? "selected" : ""}`}
                  onClick={() => handleSelect(version.version)}
                >
                  <div className="version-item-left">
                    <div className="version-dot-container">
                      <div
                        className={`version-dot ${isSelected ? "active" : ""}`}
                      />
                      {index < versions.length - 1 && (
                        <div className="version-line" />
                      )}
                    </div>
                    <div className="version-info">
                      <span className="version-name">
                        v{version.version}
                        {isLatest && (
                          <span className="version-badge">Latest</span>
                        )}
                      </span>
                      {version.message && (
                        <span className="version-description">
                          {version.message.length > 50
                            ? version.message.substring(0, 50) + "..."
                            : version.message}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="version-time">
                    {formatTime(version.timestamp)}
                  </span>
                </button>
              );
            })}

            {versions.length > 1 &&
              currentVersion !== versions[versions.length - 1]?.version && (
                <div className="version-warning">
                  <svg
                    className="warning-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Editing from here will overwrite newer versions</span>
                </div>
              )}
          </div>
        )}

        {isOpen && versions.length === 0 && (
          <div className="version-dropdown-menu">
            <div className="version-empty">No versions yet</div>
          </div>
        )}
      </div>
    </div>
  );
}
