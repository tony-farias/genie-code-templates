import { FormEvent, useEffect, useRef, useState } from "react";
import { SendIcon, SparklesIcon } from "./icons";
import type { ChatMessage, GenieResponse } from "./types";

const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function ResultsTable({ table }: { table: NonNullable<ChatMessage["table"]> }) {
  return (
    <div className="chat-table-scroll">
      <table className="chat-table">
        <thead><tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {table.rows.slice(0, 25).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, cellIndex) => <td key={cellIndex}>{value === null ? "—" : String(value)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > 25 && <span className="chat-table-note">Showing 25 of {table.rows.length} rows</span>}
    </div>
  );
}

export function GenieChat({
  title,
  description,
  suggestions,
  ask,
  compact = false,
}: {
  title: string;
  description: string;
  suggestions: string[];
  ask: (message: string, conversationId?: string | null) => Promise<GenieResponse>;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const conversation = useRef<string | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || thinking) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", text: message, at: clock() }]);
    setThinking(true);
    try {
      const response = await ask(message, conversation.current);
      conversation.current = response.conversation_id;
      setMessages((current) => [
        ...current,
        { role: "genie", text: response.text, table: response.table, at: clock() },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "genie",
          text: `The governed Genie service could not answer: ${error instanceof Error ? error.message : String(error)}`,
          at: clock(),
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <section className={`genie-chat ${compact ? "genie-chat-compact" : ""}`}>
      <header className="genie-chat-header">
        <span className="genie-avatar"><SparklesIcon size={18} /></span>
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <span className={`pill ${thinking ? "status-thinking" : "status-ready"}`}>
          {thinking ? "Thinking" : "Ready"}
        </span>
      </header>

      <div ref={transcript} className="genie-transcript">
        {messages.length === 0 ? (
          <div className="genie-welcome">
            <p>Ask questions against the governed X12 analytics model.</p>
            <div className="suggestion-list">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" disabled={thinking} onClick={() => void send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message, index) => (
              <div key={index} className={`chat-message ${message.role}`}>
                <p>{message.text}</p>
                {message.table && message.table.rows.length > 0 && <ResultsTable table={message.table} />}
                {message.at && <time>{message.at}</time>}
              </div>
            ))}
            {thinking && <div className="chat-message genie thinking">Genie is thinking…</div>}
          </div>
        )}
      </div>

      <form className="genie-composer" onSubmit={submit}>
        <textarea
          rows={1}
          aria-label="Ask Genie a question"
          placeholder="Ask about claims, providers, payments, or parser quality…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" aria-label="Send" disabled={thinking || !input.trim()}>
          <SendIcon size={16} />
        </button>
      </form>
    </section>
  );
}
