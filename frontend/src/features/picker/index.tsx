import { Route, Routes } from "react-router-dom";

import { AppHeader } from "../../components/AppHeader";
import { PickerOrderDetail } from "./PickerOrderDetail";
import { PickerQueue } from "./PickerQueue";

// Mounted at "/picker/*" (see App.tsx), so paths here are relative to /picker.
export default function PickerApp() {
  return (
    <div>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Routes>
          <Route path="/" element={<PickerQueue />} />
          <Route path="order/:orderId" element={<PickerOrderDetail />} />
        </Routes>
      </main>
    </div>
  );
}
