-- جدول اللقطات المحسوبة - يُملأ فقط عند النقر على "إعادة بناء البيانات الشاملة"
CREATE TABLE public.computed_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items_master(id) ON DELETE CASCADE,
  
  -- رصيد المخزن
  opening_qty NUMERIC NOT NULL DEFAULT 0,
  purchased_qty NUMERIC NOT NULL DEFAULT 0,
  sold_qty NUMERIC NOT NULL DEFAULT 0,
  wastage_qty NUMERIC NOT NULL DEFAULT 0,
  stock_balance NUMERIC NOT NULL DEFAULT 0, -- opening + purchased - sold - wastage
  
  -- آخر سعر شراء ومعامل الهامش
  last_purchase_price NUMERIC DEFAULT NULL,
  last_purchase_margin_factor NUMERIC DEFAULT NULL,
  last_purchase_date DATE DEFAULT NULL,
  last_purchase_invoice_id UUID DEFAULT NULL,
  
  -- حقول التتبع
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_rebuild_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  rebuild_version INTEGER NOT NULL DEFAULT 1,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- قيد فريد لكل صنف
  CONSTRAINT computed_snapshots_item_unique UNIQUE (item_id)
);

-- جدول بيانات وصفية للتحديث الشامل
CREATE TABLE public.rebuild_metadata (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton_id BOOLEAN NOT NULL DEFAULT true UNIQUE,
  last_rebuild_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  rebuild_version INTEGER NOT NULL DEFAULT 0,
  items_processed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- إدخال سجل وحيد للبيانات الوصفية
INSERT INTO public.rebuild_metadata (singleton_id, last_rebuild_at, rebuild_version, items_processed)
VALUES (true, NULL, 0, 0);

-- تفعيل RLS
ALTER TABLE public.computed_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rebuild_metadata ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول
CREATE POLICY "Owner full access" ON public.computed_snapshots
  FOR ALL USING (is_owner(auth.uid()))
  WITH CHECK (is_owner(auth.uid()));

CREATE POLICY "Owner full access" ON public.rebuild_metadata
  FOR ALL USING (is_owner(auth.uid()))
  WITH CHECK (is_owner(auth.uid()));

-- فهرس للبحث السريع
CREATE INDEX idx_computed_snapshots_item_id ON public.computed_snapshots(item_id);
CREATE INDEX idx_computed_snapshots_last_rebuild ON public.computed_snapshots(last_rebuild_at);