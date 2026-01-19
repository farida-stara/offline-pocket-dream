import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const emailSchema = z.string().trim().email("البريد الإلكتروني غير صحيح");
const passwordSchema = z
  .string()
  .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل")
  .max(72, "كلمة المرور طويلة جداً");

function getAuthErrorMessage(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid") || m.includes("credentials")) {
    return "بيانات الدخول غير صحيحة";
  }
  if (m.includes("user already") || m.includes("already registered")) {
    return "هذا البريد مسجل مسبقاً";
  }
  if (m.includes("password") && m.includes("weak")) {
    return "كلمة المرور ضعيفة";
  }
  return "حدث خطأ. حاول مرة أخرى.";
}

export default function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from as string | undefined;

  const [mode, setMode] = useState<"login" | "signup">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate(from || "/", { replace: true });
    }
  }, [user, loading, navigate, from]);

  const isValid = useMemo(() => {
    return emailSchema.safeParse(email).success && passwordSchema.safeParse(password).success;
  }, [email, password]);

  const onSubmit = async () => {
    const e = emailSchema.safeParse(email);
    const p = passwordSchema.safeParse(password);

    if (!e.success || !p.success) {
      toast({
        title: "تحقق من البيانات",
        description: "تأكد من البريد الإلكتروني وكلمة المرور.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: e.data,
          password: p.data,
        });
        if (error) throw error;
      } else {
        const redirectUrl = `${window.location.origin}/`;
        const { error } = await supabase.auth.signUp({
          email: e.data,
          password: p.data,
          options: {
            emailRedirectTo: redirectUrl,
          },
        });
        if (error) throw error;

        toast({
          title: "تم إنشاء الحساب",
          description: "تم إنشاء الحساب بنجاح. يمكنك تسجيل الدخول الآن.",
        });
        setMode("login");
      }
    } catch (err: any) {
      toast({
        title: "تعذر إكمال العملية",
        description: getAuthErrorMessage(err?.message || ""),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>تسجيل الدخول</CardTitle>
          <CardDescription>ادخل إلى النظام لإدارة المخزون والفواتير</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">دخول</TabsTrigger>
              <TabsTrigger value="signup">حساب جديد</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-login">البريد الإلكتروني</Label>
                  <Input
                    id="email-login"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password-login">كلمة المرور</Label>
                  <Input
                    id="password-login"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    placeholder="********"
                  />
                </div>

                <Button className="w-full" onClick={onSubmit} disabled={!isValid || submitting}>
                  {submitting ? "جاري الدخول..." : "دخول"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-signup">البريد الإلكتروني</Label>
                  <Input
                    id="email-signup"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password-signup">كلمة المرور</Label>
                  <Input
                    id="password-signup"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    placeholder="********"
                  />
                  <p className="text-xs text-muted-foreground">8 أحرف على الأقل</p>
                </div>

                <Button className="w-full" onClick={onSubmit} disabled={!isValid || submitting}>
                  {submitting ? "جاري إنشاء الحساب..." : "إنشاء حساب"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
