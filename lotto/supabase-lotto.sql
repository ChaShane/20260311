-- ============================================
-- 로또 추첨 이력 저장 (Supabase)
-- Supabase 대시보드 → SQL Editor 에서 이 스크립트 실행
-- ============================================

-- 기존 테이블 있으면 제거 (필요시 주석 처리)
-- DROP TABLE IF EXISTS public.lotto_draws;

-- 로또 추첨 결과 테이블 (CHECK에는 서브쿼리 불가 → 개수/범위는 트리거로 검사)
CREATE TABLE IF NOT EXISTS public.lotto_draws (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numbers       integer[] NOT NULL,
  bonus         integer NOT NULL CHECK (bonus >= 1 AND bonus <= 45),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lotto_numbers_count CHECK (array_length(numbers, 1) = 6)
);

-- 번호 6개가 모두 1~45인지 검사 (INSERT/UPDATE 시)
CREATE OR REPLACE FUNCTION public.lotto_validate_numbers()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (SELECT bool_and(n >= 1 AND n <= 45) FROM unnest(NEW.numbers) AS n) THEN
    RAISE EXCEPTION 'lotto_draws.numbers: 모든 번호는 1~45 사이여야 합니다.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lotto_validate_numbers ON public.lotto_draws;
CREATE TRIGGER trg_lotto_validate_numbers
  BEFORE INSERT OR UPDATE ON public.lotto_draws
  FOR EACH ROW EXECUTE PROCEDURE public.lotto_validate_numbers();

-- 인덱스: 최신순 조회
CREATE INDEX IF NOT EXISTS idx_lotto_draws_created_at
  ON public.lotto_draws (created_at DESC);

-- Row Level Security (선택): 익명/인증 사용자만 insert, 모두 조회 가능
ALTER TABLE public.lotto_draws ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read lotto_draws"
  ON public.lotto_draws FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert lotto_draws"
  ON public.lotto_draws FOR INSERT
  WITH CHECK (true);

-- (선택) 웹에서 직접 넣지 않고, 서버/Edge Function에서만 넣으려면 위 INSERT 정책 삭제 후
-- CREATE POLICY "Service role only" ON public.lotto_draws FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 예시: 수동으로 추첨 결과 1건 넣기
-- ============================================
-- INSERT INTO public.lotto_draws (numbers, bonus)
-- VALUES (ARRAY[3, 12, 25, 33, 41, 44], 7);

-- ============================================
-- 최근 N건 조회 (웹 앱에서 사용)
-- ============================================
-- SELECT id, numbers, bonus, created_at
-- FROM public.lotto_draws
-- ORDER BY created_at DESC
-- LIMIT 10;

COMMENT ON TABLE public.lotto_draws IS '로또 번호 추첨 이력 (메인 6개 + 보너스 1개)';
