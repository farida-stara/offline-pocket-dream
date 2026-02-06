import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import OpeningStock from "./pages/OpeningStock";
import PurchaseEntry from "./pages/PurchaseEntry";
import PurchasesList from "./pages/PurchasesList";
import PurchaseDetails from "./pages/PurchaseDetails";
import SalesEntry from "./pages/SalesEntry";
import SalesList from "./pages/SalesList";
import SalesDetails from "./pages/SalesDetails";
import InventoryReport from "./pages/InventoryReport";
import ItemsMaster from "./pages/ItemsMaster";
import SuppliersMaster from "./pages/SuppliersMaster";
import CustomersMaster from "./pages/CustomersMaster";
import PaymentsLedger from "./pages/PaymentsLedger";
import EmployeesMaster from "./pages/EmployeesMaster";
import WastageEntry from "./pages/WastageEntry";
import WastageList from "./pages/WastageList";
import WastageDetails from "./pages/WastageDetails";
import AuthPage from "./pages/Auth";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // البيانات لا تنتهي صلاحيتها - تبقى في الكاش حتى التحديث اليدوي
      staleTime: Infinity,
      // الكاش يبقى للأبد حتى يتم مسحه يدوياً
      gcTime: Infinity,
      // لا يُعاد التحميل عند التركيز على النافذة
      refetchOnWindowFocus: false,
      // لا يُعاد التحميل عند إعادة الاتصال بالإنترنت
      refetchOnReconnect: false,
      // لا يُعاد التحميل عند mount المكون
      refetchOnMount: false,
      // عدد المحاولات عند الفشل
      retry: 1,
    },
  },
});
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/opening-stock"
              element={
                <ProtectedRoute>
                  <OpeningStock />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases"
              element={
                <ProtectedRoute>
                  <PurchasesList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases/new"
              element={
                <ProtectedRoute>
                  <PurchaseEntry />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases/:id"
              element={
                <ProtectedRoute>
                  <PurchaseDetails />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sales"
              element={
                <ProtectedRoute>
                  <SalesList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sales/new"
              element={
                <ProtectedRoute>
                  <SalesEntry />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sales/:id"
              element={
                <ProtectedRoute>
                  <SalesDetails />
                </ProtectedRoute>
              }
            />
            <Route
              path="/items"
              element={
                <ProtectedRoute>
                  <ItemsMaster />
                </ProtectedRoute>
              }
            />
            <Route
              path="/suppliers"
              element={
                <ProtectedRoute>
                  <SuppliersMaster />
                </ProtectedRoute>
              }
            />
            <Route
              path="/customers"
              element={
                <ProtectedRoute>
                  <CustomersMaster />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <InventoryReport />
                </ProtectedRoute>
              }
            />

            <Route
              path="/payments"
              element={
                <ProtectedRoute>
                  <PaymentsLedger />
                </ProtectedRoute>
              }
            />

            <Route
              path="/employees"
              element={
                <ProtectedRoute>
                  <EmployeesMaster />
                </ProtectedRoute>
              }
            />

            {/* Wastage (توالف) */}
            <Route
              path="/wastage"
              element={
                <ProtectedRoute>
                  <WastageList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/wastage/new"
              element={
                <ProtectedRoute>
                  <WastageEntry />
                </ProtectedRoute>
              }
            />
            <Route
              path="/wastage/:id"
              element={
                <ProtectedRoute>
                  <WastageDetails />
                </ProtectedRoute>
              }
            />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
