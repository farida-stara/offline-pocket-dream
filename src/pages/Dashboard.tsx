import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Package, ShoppingCart, TrendingUp, Users, Warehouse, DollarSign, LogOut, ListChecks, Building2, CreditCard, Trash2, UserCog, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const handleGlobalRefresh = async () => {
    setRefreshing(true);
    try {
      // Invalidate and refetch all major caches
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-reps"] }),
        queryClient.invalidateQueries({ queryKey: ["purchases"] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["wastage"] }),
        queryClient.invalidateQueries({ queryKey: ["opening-stock"] }),
        queryClient.invalidateQueries({ queryKey: ["payment-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-report"] }),
        queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("purchase-details") }),
        queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("sales-details") }),
        queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("sales-stock-pricing") }),
        queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("wastage-details") }),
      ]);
      toast.success("تم تحديث جميع البيانات والكاش بنجاح");
    } catch (e: any) {
      toast.error("حدث خطأ أثناء التحديث: " + (e?.message || ""));
    } finally {
      setRefreshing(false);
    }
  };

  const menuItems = [
    {
      title: "إدخال مشتريات",
      description: "إضافة فاتورة مشتريات جديدة",
      icon: ShoppingCart,
      color: "bg-primary",
      route: "/purchases/new",
    },
    {
      title: "سجل المشتريات",
      description: "عرض وتصفح فواتير المشتريات",
      icon: Warehouse,
      color: "bg-primary/90",
      route: "/purchases",
    },
    {
      title: "إدخال مبيعات",
      description: "إضافة فاتورة مبيعات جديدة",
      icon: TrendingUp,
      color: "bg-accent",
      route: "/sales/new",
    },
    {
      title: "سجل المبيعات",
      description: "عرض وتصفح فواتير المبيعات",
      icon: DollarSign,
      color: "bg-accent/90",
      route: "/sales",
    },
    {
      title: "إدارة الأصناف",
      description: "إضافة وتعديل الأصناف والمنتجات",
      icon: ListChecks,
      color: "bg-secondary",
      route: "/items",
    },
    {
      title: "سجل الموردين",
      description: "إضافة وتعديل الموردين",
      icon: Building2,
      color: "bg-muted",
      route: "/suppliers",
    },
    {
      title: "سجل الزبائن",
      description: "إضافة وتعديل الزبائن",
      icon: Users,
      color: "bg-muted",
      route: "/customers",
    },
    {
      title: "سجل الموظفين",
      description: "إضافة وتعديل الموظفين (مندوبين)",
      icon: UserCog,
      color: "bg-muted",
      route: "/employees",
    },
    {
      title: "الرصيد الافتتاحي",
      description: "إدخال الكميات الافتتاحية للمخزون",
      icon: Package,
      color: "bg-secondary",
      route: "/opening-stock",
    },
    {
      title: "التقارير",
      description: "عرض تقارير المخزون والجرد",
      icon: Users,
      color: "bg-muted",
      route: "/reports",
    },
    {
      title: "سجل الدفع",
      description: "تسجيل وعرض الدفعات (كاش/أجل/كي نت/تحويل)",
      icon: CreditCard,
      color: "bg-muted",
      route: "/payments",
    },
    {
      title: "سجل التوالف",
      description: "تسجيل الأصناف التالفة (يخصم من المخزون)",
      icon: Trash2,
      color: "bg-destructive/80",
      route: "/wastage",
    },
  ];

  const onLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">نظام إدارة المخزون</h1>
            <p className="text-muted-foreground">مرحباً بك في نظام إدارة المخزون والمبيعات</p>
            {user?.email ? <p className="text-xs text-muted-foreground mt-2">{user.email}</p> : null}
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleGlobalRefresh} disabled={refreshing} className="w-fit">
              <RefreshCw className={`h-4 w-4 ml-2 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "جاري التحديث..." : "تحديث شامل للبيانات"}
            </Button>
            <Button variant="outline" onClick={onLogout} className="w-fit">
              <LogOut className="h-4 w-4 ml-2" />
              تسجيل الخروج
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <Card
                key={index}
                className="hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => navigate(item.route)}
              >
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className={`${item.color} p-3 rounded-lg group-hover:scale-110 transition-transform`}>
                      <Icon className="h-6 w-6 text-primary-foreground" />
                    </div>
                    <CardTitle className="text-xl">{item.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;