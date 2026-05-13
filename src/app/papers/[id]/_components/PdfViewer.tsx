"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";

// PDF.js worker via CDN. For production, copy the worker into /public.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Props = {
  url: string;
  page: number;
  onPageChange: (page: number) => void;
};

export function PdfViewer({ url, page, onPageChange }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.1);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const el = pageRefs.current.get(page);
    if (el && containerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [page, numPages]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 bg-background">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums">
            {page} / {numPages || "?"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPageChange(Math.min(numPages || page, page + 1))}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto px-2 py-3">
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="text-center text-sm py-10">Loading PDF...</div>}
          error={<div className="text-center text-sm text-destructive py-10">Failed to load PDF.</div>}
        >
          {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
            <div
              key={p}
              ref={(el) => {
                if (el) pageRefs.current.set(p, el);
                else pageRefs.current.delete(p);
              }}
              className="mb-3 shadow-sm mx-auto w-fit"
            >
              <Page pageNumber={p} scale={scale} renderAnnotationLayer renderTextLayer />
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
}
