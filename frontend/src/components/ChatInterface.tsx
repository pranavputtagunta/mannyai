import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sendCopilotPrompt } from "../services/api";
import "../assets/ChatInterface.css";

interface ChatInterfaceProps {
  onImport: (url: string) => Promise<void>;
  isLoading: boolean;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function ChatInterface({
  onImport,
  isLoading,
}: ChatInterfaceProps): JSX.Element {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Paste an Onshape URL to import a model, or click a broken face and tell me what to fix.",
    },
  ]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // We explicitly namespace React.FormEvent here to avoid the global DOM collision
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (input.includes("cad.onshape.com")) {
      const url = input;
      setMessages((prev) => [
        ...prev,
        { role: "user", text: `Importing: ${url}` },
      ]);
      setInput("");
      await onImport(url);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Model imported successfully. What would you like to modify?",
        },
      ]);
      return;
    }

    const userMsg = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setIsProcessing(true);

    try {
      const response = await sendCopilotPrompt(userMsg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: response.message || "Modification applied.",
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Failed to apply modification. Please check constraints.",
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
            placeholder="Paste link or type prompt..."
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
