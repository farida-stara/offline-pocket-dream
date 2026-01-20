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
import SalesEntry from "./pages/SalesEntry";
import SalesList from "./pages/SalesList";
import InventoryReport from "./pages/InventoryReport";
import AuthPage from "./pages/Auth";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient();

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
              path="/reports"
              element={
                <ProtectedRoute>
                  <InventoryReport />
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
