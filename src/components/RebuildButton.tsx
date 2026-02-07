/**
 * زر إعادة بناء البيانات - للاستخدام في صفحات التفاصيل
 * 
 * يوفر أيقونة صغيرة لتشغيل إعادة بناء البيانات الشاملة
 * من أي صفحة بدلاً من الذهاب للوحة التحكم
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fullDataRebuild, RebuildProgress } from "@/lib/fullDataRebuild";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface RebuildButtonProps {
  /** شكل الزر - أيقونة صغيرة أو زر كامل */
  variant?: "icon" | "full";
  /** يُستدعى بعد اكتمال إعادة البناء بنجاح */
  onComplete?: () => void;
}

export function RebuildButton({ variant = "icon", onComplete }: RebuildButtonProps) {
  const queryClient = useQueryClient();
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState<RebuildProgress | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleRebuild = async () => {
    setRebuilding(true);
    setDialogOpen(true);
    setProgress(null);

    try {
      const result = await fullDataRebuild((p) => setProgress(p));

      if (result.success) {
        // تحديث الكاش
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["computed-snapshots"] }),
          queryClient.invalidateQueries({ queryKey: ["rebuild-status"] }),
          queryClient.invalidateQueries({ queryKey: ["inventory-report"] }),
        ]);

        toast.success(
          `تم إعادة بناء البيانات - ${result.itemsProcessed} صنف (الإصدار ${result.rebuildVersion})`
        );
        
        onComplete?.();
      } else {
        toast.error("فشل إعادة البناء: " + result.error);
      }
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message || "حدث خطأ غير متوقع"));
    } finally {
      setRebuilding(false);
      setDialogOpen(false);
      setProgress(null);
    }
  };

  if (variant === "full") {
    return (
      <>
        <Button
          variant="default"
          onClick={handleRebuild}
          disabled={rebuilding}
          className="bg-primary"
        >
          {rebuilding ? (
            <Loader2 className="h-4 w-4 ml-2 animate-spin" />
          ) : (
            <Database className="h-4 w-4 ml-2" />
          )}
          {rebuilding ? "جاري إعادة البناء..." : "إعادة بناء البيانات"}
        </Button>

        <RebuildProgressDialog
          open={dialogOpen}
          progress={progress}
        />
      </>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRebuild}
              disabled={rebuilding}
              className="h-8 w-8"
            >
              {rebuilding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>إعادة بناء البيانات الشاملة</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <RebuildProgressDialog
        open={dialogOpen}
        progress={progress}
      />
    </>
  );
}

function RebuildProgressDialog({
  open,
  progress,
}: {
  open: boolean;
  progress: RebuildProgress | null;
}) {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>جاري إعادة بناء البيانات</DialogTitle>
          <DialogDescription>
            يرجى الانتظار حتى اكتمال العملية...
          </DialogDescription>
        </DialogHeader>

        {progress && (
          <div className="space-y-3">
            <p className="text-sm">{progress.step}</p>
            <Progress value={(progress.current / progress.total) * 100} className="h-2" />
            <p className="text-xs text-muted-foreground">
              الخطوة {progress.current} من {progress.total}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
