import React, { useEffect, useRef, useState, type ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  sendCopilotPrompt,
  type Coordinate,
} from "../services/api";
import "../assets/ChatInterface.css";

interface ChatInterfaceProps {
  isLoading: boolean;
  selectedCoordinates: Coordinate | null;
  selectedMode: "click" | "lasso" | "circle" | null;
  onPromptCaptured: (prompt: string) => void;
  onOperationApplied: () => Promise<void>;
  onClearSelection: () => void;
  onRecolorModel: (
    color: string | null,
    target: "model" | "sphere" | "background" | "all",
    anchor: [number, number, number] | null,
  ) => void;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function ChatInterface({
  isLoading,
  selectedCoordinates,
  selectedMode,
  onPromptCaptured,
  onOperationApplied,
  onClearSelection,
  onRecolorModel,
}: ChatInterfaceProps): ReactElement {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Pick a region, then describe exactly what to change in this chat prompt. That prompt will be saved into the JSON intent.",
    },
  ]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [awaitingDoneConfirmation, setAwaitingDoneConfirmation] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isProcessing]);

  // We explicitly namespace React.FormEvent here to avoid the global DOM collision
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input;

    if (awaitingDoneConfirmation) {
      const normalized = userMsg.trim().toLowerCase();
      const isDone = /^(yes|y|done|finished|complete|clear|clear selection)$/.test(normalized);
      const isNotDone = /^(no|n|not yet|keep|continue)$/.test(normalized);

      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: userMsg }]);

      if (isDone) {
        onClearSelection();
        setAwaitingDoneConfirmation(false);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Selection cleared. Pick another area when you're ready." },
        ]);
        return;
      }

      if (isNotDone) {
        setAwaitingDoneConfirmation(false);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Keeping the current selection active." },
        ]);
        return;
      }
    }

    onPromptCaptured(userMsg);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setIsProcessing(true);

    try {
  	  const response = await sendCopilotPrompt(userMsg, selectedCoordinates);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: response.message || "Modification applied.",
        },
      ]);

      if (response?.executed) {
        if (response?.action === "recolor_model") {
          const recolor = typeof response?.model_color === "string" ? response.model_color : "default";
          const target =
            response?.model_color_target === "sphere" ||
            response?.model_color_target === "background" ||
            response?.model_color_target === "all"
              ? response.model_color_target
              : "model";
          const anchor =
            Array.isArray(response?.model_color_anchor) && response.model_color_anchor.length === 3
              ? [
                  Number(response.model_color_anchor[0]),
                  Number(response.model_color_anchor[1]),
                  Number(response.model_color_anchor[2]),
                ] as [number, number, number]
              : null;
          onRecolorModel(recolor === "default" ? null : recolor, target, anchor);
        } else {
          await onOperationApplied();
          if (selectedCoordinates) {
            setAwaitingDoneConfirmation(true);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text: "Done with this area? Reply 'yes' or 'done' and I will clear the blue highlight.",
              },
            ]);
          }
        }
      }
    } catch (err: any) {
      const backendMessage =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to apply modification. Please check constraints.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: String(backendMessage),
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
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        {selectedCoordinates && (
          <div className="selection-context">
            Using {selectedMode} selection at ({selectedCoordinates.x.toFixed(2)},{" "}
            {selectedCoordinates.y.toFixed(2)}, {selectedCoordinates.z.toFixed(2)})
          </div>
        )}

        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || isProcessing}
            placeholder="Type prompt..."
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
