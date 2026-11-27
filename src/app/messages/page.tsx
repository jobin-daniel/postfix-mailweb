import { Suspense } from "react";
import { MessagesClient } from "@/components/MessagesClient";

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-sm text-zinc-400">
          Loading messages…
        </div>
      }
    >
      <MessagesClient />
    </Suspense>
  );
}
