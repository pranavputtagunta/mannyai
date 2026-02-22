import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { loadUseCase } from "../services/api";
import "../assets/ChatInterface.css";

interface ChatInterfaceProps {
  isLoading: boolean;
  cadContext: { did: string; wvm: string; wvmid: string; eid: string } | null;
  onModelUpdated: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const createMessage = (role: "user" | "assistant", text: string): Message => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  text,
});

export default function ChatInterface({
  isLoading,
  cadContext,
  onModelUpdated,
}: Readonly<ChatInterfaceProps>) {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    createMessage(
      "assistant",
      "Describe what to change and I’ll handle the model update.",
    ),
  ]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // We explicitly namespace React.FormEvent here to avoid the global DOM collision
  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input;
    setInput("");
    setMessages((prev) => [...prev, createMessage("user", userMsg)]);
    setIsProcessing(true);

    try {
      if (!cadContext) {
        throw new Error("Please import a CAD model first.");
      }

      const useCase = await loadUseCase();

      // Step 1 & 2: Send chat to determine intent
      const chatResponse = await fetch("http://localhost:8000/api/cad/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: cadContext.did,
          wid: cadContext.wvmid, // Assuming wvmid is the workspace id
          eid: cadContext.eid,
          use_case: useCase || "",
          user_message: userMsg,
          chat_history: messages.map((m) => ({
            role: m.role,
            content: m.text,
          })),
        }),
      });

      if (!chatResponse.ok) {
        throw new Error(`Backend error: ${chatResponse.status}`);
      }

      const chatData = await chatResponse.json();

      // Step 6: Show confirmation message immediately
      setMessages((prev) => [
        ...prev,
        createMessage(
          "assistant",
          chatData.assistant_message || "I'm here to help.",
        ),
      ]);

      // Step 3, 4, 5: If intent is modify, trigger the modification agent
      if (chatData.intent === "modify") {
        setIsEditing(true);
        const modifyResponse = await fetch(
          "http://localhost:8000/api/cad/modify",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              did: cadContext.did,
              wid: cadContext.wvmid,
              eid: cadContext.eid,
              use_case: useCase || "",
              user_message: userMsg,
              chat_history: messages.map((m) => ({
                role: m.role,
                content: m.text,
              })),
            }),
          },
        );

        if (!modifyResponse.ok) {
          throw new Error(`Modification failed: ${modifyResponse.status}`);
        }

        const modifyData = await modifyResponse.json();

        // Show success message
        setMessages((prev) => [
          ...prev,
          createMessage(
            "assistant",
            modifyData.message || "Modification applied successfully.",
          ),
        ]);

        // Refetch the CAD model
        onModelUpdated();
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to apply modification. Please check constraints.";
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", errorMessage),
      ]);
    } finally {
      setIsProcessing(false);
      setIsEditing(false);
    }
  };

  return (
    <div className="chat-layout">
      <div className="messages-area">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`message-row ${msg.role}`}
            >
              <div className={`message-bubble ${msg.role}`}>{msg.text}</div>
            </motion.div>
          ))}

          {isProcessing && !isEditing && (
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

          {isEditing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="message-row assistant"
            >
              <div className="message-bubble assistant editing-indicator">
                <span className="editing-text">Editing model</span>
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
