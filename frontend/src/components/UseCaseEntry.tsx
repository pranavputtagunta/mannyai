import { useState, useEffect } from "react";
import { saveUseCase, loadUseCase } from "../services/api";

export default function UseCaseEntry() {
  const [useCase, setUseCase] = useState<string>("");
  const [originalUseCase, setOriginalUseCase] = useState<string>("");
  const [isEditingUseCase, setIsEditingUseCase] = useState<boolean>(false);
  const [hasExistingUseCase, setHasExistingUseCase] = useState<boolean>(false);

  useEffect(() => {
    const checkExistingUseCase = async () => {
      try {
        const text = await loadUseCase();
        if (text && text.trim() !== "") {
          setHasExistingUseCase(true);
          setUseCase(text);
          setOriginalUseCase(text);
        }
      } catch (err) {
        console.error("Failed to check existing use case:", err);
      }
    };
    checkExistingUseCase();
  }, []);

  const handleSaveUseCase = async () => {
    try {
      await saveUseCase(useCase);
      setHasExistingUseCase(true);
      setOriginalUseCase(useCase);
      setIsEditingUseCase(false);
    } catch (err) {
      console.error("Failed to save use case:", err);
    }
  };

  const handleOpenEditor = async () => {
    if (hasExistingUseCase && !useCase) {
      try {
        const text = await loadUseCase();
        setUseCase(text);
        setOriginalUseCase(text);
      } catch (err) {
        console.error("Failed to load use case:", err);
      }
    }
    setIsEditingUseCase(true);
  };

  const handleCancel = () => {
    setUseCase(originalUseCase);
    setIsEditingUseCase(false);
  };

  return (
    <div className="use-case-section" style={{ marginTop: "1rem" }}>
      {!isEditingUseCase ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleOpenEditor}
            className="url-submit-btn"
            style={{ flex: 1 }}
          >
            {hasExistingUseCase ? "Edit Use Case" : "Add Use Case"}
          </button>
        </div>
      ) : (
        <div
          className="use-case-editor"
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <textarea
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            placeholder="Enter the use case of the part..."
            rows={4}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #ccc",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleSaveUseCase}
              className="url-submit-btn"
              style={{ flex: 1 }}
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="url-submit-btn"
              style={{ flex: 1, backgroundColor: "#666" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
