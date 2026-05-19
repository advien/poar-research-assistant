"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { createClient } from "@/lib/supabase/client";
import type { PaperRow } from "@/types/db";
import { UploadCloud, Loader2 } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

type ListItem = Pick<
  PaperRow,
  | "id"
  | "title"
  | "authors"
  | "journal"
  | "year"
  | "tags"
  | "page_count"
  | "status"
  | "error"
  | "summary"
  | "created_at"
>;

type Props = {
  onUploadStart: (paper: ListItem) => void;
};

type Pending = { name: string; size: number; phase: "uploading" | "ingesting" | "error"; message?: string };

export function UploadDropzone({ onUploadStart }: Props) {
  const [pending, setPending] = useState<Pending[]>([]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const supabase = createClient();

      for (const file of files) {
        // Defence in depth: react-dropzone's `accept` already filters at the
        // OS dialog, but a drag-and-drop or a renamed file can slip through.
        // We surface a clear error instead of silently skipping.
        if (file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) {
          setPending((p) => [
            ...p,
            {
              name: file.name,
              size: file.size,
              phase: "error",
              message: "only .pdf files are supported",
            },
          ]);
          continue;
        }

        setPending((p) => [...p, { name: file.name, size: file.size, phase: "uploading" }]);

        try {
          // 1. Ask the server for an upload slot + paper_id.
          const initRes = await fetch("/api/papers/upload", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              size: file.size,
              content_type: file.type,
            }),
          });
          if (!initRes.ok) {
            // Surface the server's validation message (size, extension, MIME).
            const j = await initRes.json().catch(() => ({}));
            throw new Error(
              j?.detail ?? j?.error ?? `upload init failed (${initRes.status})`
            );
          }
          const { paper_id, storage_path, token } = (await initRes.json()) as {
            paper_id: string;
            storage_path: string;
            token: string;
          };

          // Optimistic placeholder so the user sees the paper immediately.
          onUploadStart({
            id: paper_id,
            title: file.name.replace(/\.pdf$/i, ""),
            authors: [],
            journal: null,
            year: null,
            tags: [],
            page_count: null,
            status: "pending",
            error: null,
            summary: null,
            created_at: new Date().toISOString(),
          });

          // 2. Upload the bytes directly to Supabase Storage with the signed token.
          const { error: upErr } = await supabase.storage
            .from("papers")
            .uploadToSignedUrl(storage_path, token, file, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (upErr) throw upErr;

          // 3. Kick off ingestion.
          setPending((p) =>
            p.map((x) => (x.name === file.name ? { ...x, phase: "ingesting" } : x))
          );
          const ingestRes = await fetch("/api/papers/ingest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ paper_id }),
          });
          if (!ingestRes.ok) {
            const j = await ingestRes.json().catch(() => ({}));
            throw new Error(j.error ?? `ingest failed (${ingestRes.status})`);
          }

          setPending((p) => p.filter((x) => x.name !== file.name));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setPending((p) =>
            p.map((x) => (x.name === file.name ? { ...x, phase: "error", message: msg } : x))
          );
        }
      }
    },
    [onUploadStart]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFiles,
    accept: { "application/pdf": [".pdf"] },
    multiple: true,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "rounded-lg border border-dashed p-8 text-center cursor-pointer transition-colors",
        isDragActive ? "border-primary bg-accent" : "hover:bg-accent/50"
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm">
        <span className="font-medium">Drop PDFs here</span> or click to browse
      </p>
      <p className="text-xs text-muted-foreground">PDFs only. Up to 25 MB per file.</p>
      {pending.length > 0 && (
        <ul className="mt-4 space-y-1 text-left mx-auto max-w-md text-xs">
          {pending.map((p) => (
            <li
              key={p.name}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md border px-3 py-1.5",
                p.phase === "error" && "border-destructive text-destructive"
              )}
            >
              <span className="truncate">
                {p.name} <span className="text-muted-foreground">({formatBytes(p.size)})</span>
              </span>
              <span className="flex items-center gap-1.5">
                {p.phase !== "error" && <Loader2 className="h-3 w-3 animate-spin" />}
                {p.phase === "uploading" && "uploading"}
                {p.phase === "ingesting" && "ingesting"}
                {p.phase === "error" && (p.message ?? "error")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
