import type { Metadata } from "next";

import { RescueWorkspace } from "@/components/rescue-workspace";

export const metadata: Metadata = {
  title: "Local Rescue Demo",
};

export default function DemoPage() {
  return <RescueWorkspace />;
}
