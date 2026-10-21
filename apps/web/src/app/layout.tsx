import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "FlowForge — Visual Workflow Automation",
  description: "Construct, validate, and execute resilient workflow automation pipelines."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#0f172a",
          color: "#f8fafc"
        }}
      >
        {children}
      </body>
    </html>
  );
}
