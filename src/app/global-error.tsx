"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.error("[POAR] global error", error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1.5rem",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
            POAR Research Assistant ran into an unexpected error.
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>
            The application root failed to render. Try again, or reload the page.
            {error.digest ? (
              <>
                <br />
                <code style={{ fontSize: 11, opacity: 0.5 }}>digest {error.digest}</code>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#fafafa",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
