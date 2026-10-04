"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownEditor({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button type="button" className={`btn btn-sm ${preview ? "btn-ghost" : "btn-primary"}`} onClick={() => setPreview(false)}>
          Escribir
        </button>
        <button type="button" className={`btn btn-sm ${preview ? "btn-primary" : "btn-ghost"}`} onClick={() => setPreview(true)}>
          Vista previa
        </button>
      </div>
      <textarea
        id={name}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`field min-h-[24rem] font-mono text-sm ${preview ? "hidden" : ""}`}
      />
      {preview && (
        <div className="parchment prose-order min-h-[24rem] p-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
