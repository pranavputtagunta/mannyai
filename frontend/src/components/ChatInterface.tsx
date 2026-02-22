// frontend/src/components/ChatInterface.tsx
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { applyCadQueryFromText } from "../services/api";
import "../assets/ChatInterface.css";

interface ChatInterfaceProps {
  isLoading: boolean;
  modelId: string | null;
  viewingVersion?: number | null;
  latestVersion?: number | null;
  onModelUpdated: (newGlbUrl: string) => void;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

const BACKEND_BASE = "http://localhost:8000";

function toAbsoluteUrl(maybeRelativeUrl: string): string {
  // Handles both:
  //  - "/api/cad/.../download/glb"
  //  - "http://localhost:8000/api/cad/.../download/glb"
  const u = new URL(maybeRelativeUrl, BACKEND_BASE);
  // single cache-bust param (overwrite if exists)
  u.searchParams.set("t", String(Date.now()));
  return u.toString();
}

export default function ChatInterface({
  isLoading,
  modelId,
  viewingVersion,
  latestVersion,
  onModelUpdated,
}: ChatInterfaceProps): JSX.Element {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Upload a STEP file, then tell me what to change.",
    },
  ]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Determine if editing from a previous version (will cause truncation)
  const isEditingFromPrevious =
    viewingVersion != null &&
    latestVersion != null &&
    viewingVersion < latestVersion;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (!modelId) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Upload a STEP file first." },
      ]);
      return;
    }

    const userMsg = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setIsProcessing(true);

    try {
      // AI mode: backend classifies intent and routes to appropriate handler
      // Pass from_version if editing from a previous version (triggers truncation)
      const fromVersion = isEditingFromPrevious ? viewingVersion : undefined;
      const res = await applyCadQueryFromText(modelId, userMsg, fromVersion);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.message || "Response received." },
      ]);

      // Only update the model view if this was a modification (glb_url present)
      if (res.glb_url) {
        const glbUrl = toAbsoluteUrl(res.glb_url);
        onModelUpdated(glbUrl);
      }
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            err?.message ||
            "Failed to apply modification. Check server logs for details.",
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="chat-layout">
      <div className="messages-area">
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`message-row ${msg.role}`}
            >
              <div className={`message-bubble ${msg.role}`}>{msg.text}</div>
            </motion.div>
          ))}

          {isProcessing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="message-row assistant"
            >
              <div className="message-bubble assistant">
                <div className="typing-indicator">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="input-container">
        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || isProcessing}
            placeholder="e.g. add a ball on top / scale 1.2 / cut a hole"
            className="chat-input"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isProcessing}
            className="send-btn"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="send-icon"
            >
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
