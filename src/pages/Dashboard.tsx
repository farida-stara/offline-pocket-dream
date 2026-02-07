import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Package, ShoppingCart, TrendingUp, Users, Warehouse, DollarSign, LogOut, ListChecks, Building2, CreditCard, Trash2, UserCog, RefreshCw, Database, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { fullDataRebuild, getRebuildStatus, RebuildProgress } from "@/lib/fullDataRebuild";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState<RebuildProgress | null>(null);

  // جلب حالة آخر إعادة بناء
  const { data: rebuildStatus, refetch: refetchStatus } = useQuery({
    queryKey: ["rebuild-status"],
    queryFn: getRebuildStatus,
    staleTime: Infinity,
    refetchOnMount: false,
  });

  /**
   * إعادة بناء البيانات الشاملة
   * هذا هو المكان الوحيد لتنفيذ كل الحسابات
   */
  const handleFullDataRebuild = async () => {
    setRebuilding(true);
    setProgress(null);
    
    try {
      const result = await fullDataRebuild((p) => setProgress(p));
      
      if (result.success) {
        // تحديث الكاش بعد إعادة البناء
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["computed-snapshots"] }),
          queryClient.invalidateQueries({ queryKey: ["rebuild-status"] }),
          queryClient.invalidateQueries({ queryKey: ["inventory-report"] }),
        ]);
        
        toast.success(
          `تم إعادة بناء البيانات بنجاح - ${result.itemsProcessed} صنف (الإصدار ${result.rebuildVersion})`
        );
        refetchStatus();
      } else {
        toast.error("فشل إعادة بناء البيانات: " + result.error);
      }
    } catch (e: any) {
      toast.error("حدث خطأ أثناء إعادة البناء: " + (e?.message || ""));
    } finally {
      setRebuilding(false);
      setProgress(null);
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
        {/* تحذير إذا لم يتم إعادة البناء من قبل */}
        {rebuildStatus && !rebuildStatus.hasRebuild && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>تنبيه هام</AlertTitle>
            <AlertDescription>
              لم يتم تنفيذ إعادة بناء البيانات بعد. يرجى النقر على زر "إعادة بناء البيانات الشاملة" للحصول على حسابات المخزون.
            </AlertDescription>
          </Alert>
        )}

        {/* شريط التقدم أثناء إعادة البناء */}
        {rebuilding && progress && (
          <Alert className="mb-4">
            <Database className="h-4 w-4" />
            <AlertTitle>جاري إعادة بناء البيانات...</AlertTitle>
            <AlertDescription className="mt-2">
              <p className="mb-2">{progress.step}</p>
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                الخطوة {progress.current} من {progress.total}
              </p>
            </AlertDescription>
          </Alert>
        )}

        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">نظام إدارة المخزون</h1>
            <p className="text-muted-foreground">مرحباً بك في نظام إدارة المخزون والمبيعات</p>
            {user?.email ? <p className="text-xs text-muted-foreground mt-2">{user.email}</p> : null}
            {rebuildStatus?.hasRebuild && (
              <p className="text-xs text-muted-foreground mt-1">
                آخر إعادة بناء: {new Date(rebuildStatus.lastRebuildAt!).toLocaleString("ar-KW")} 
                {" "}(الإصدار {rebuildStatus.rebuildVersion} - {rebuildStatus.itemsProcessed} صنف)
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button 
              variant="default" 
              onClick={handleFullDataRebuild} 
              disabled={rebuilding} 
              className="w-fit bg-primary"
            >
              <Database className={`h-4 w-4 ml-2 ${rebuilding ? "animate-pulse" : ""}`} />
              {rebuilding ? "جاري إعادة البناء..." : "إعادة بناء البيانات الشاملة"}
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