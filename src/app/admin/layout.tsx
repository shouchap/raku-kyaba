import type { ReactNode } from "react";
import AdminNav from "@/components/AdminNav";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <main className="py-4 sm:py-6 px-3 sm:px-4">
        <div className="mx-auto max-w-4xl rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[50vh]">
          {children}
        </div>
      </main>
    </div>
  );
}
