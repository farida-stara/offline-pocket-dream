import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Package, ShoppingCart, TrendingUp, Users, Warehouse, DollarSign, LogOut, ListChecks, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

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

          <Button variant="outline" onClick={onLogout} className="w-fit">
            <LogOut className="h-4 w-4 ml-2" />
            تسجيل الخروج
          </Button>
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