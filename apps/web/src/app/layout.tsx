import type { Metadata } from "next";
import React from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowForge — Visual Workflow Automation",
  description: "Construct, validate, and execute resilient workflow automation pipelines.",
  other: {
    "color-scheme": "dark"
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
