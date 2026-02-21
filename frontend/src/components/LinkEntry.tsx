interface LinkEntryProps {
  isLoading: boolean;
  onImport: (url: string) => void;
}

export default function LinkEntry({ isLoading, onImport }: LinkEntryProps) {
  return (
    <div className="link-entry-container">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const input = form.elements.namedItem("url") as HTMLInputElement;
          if (input.value.trim()) {
            onImport(input.value.trim());
          }
        }}
        className="url-form"
      >
        <input
          name="url"
          type="text"
          placeholder="Paste Onshape URL..."
          className="url-input"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading} className="url-submit-btn">
          Load
        </button>
      </form>
    </div>
  );
}
